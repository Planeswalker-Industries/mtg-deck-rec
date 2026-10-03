package crawl

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gocolly/colly/v2"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// newFetcherAt stands a fetcher's handlers up against a local server, so blocks and backoff are testable without
// the internet. The test server answers robots.txt permissively, because colly consults it on every request.
func newFetcherAt(t *testing.T, policy Policy, handler http.Handler) (*Fetcher, string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/robots.txt" {
			fmt.Fprint(w, "User-agent: *\nDisallow:\n")
			return
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)

	// colly's AllowedDomains matches the bare hostname, not host:port, so hand it the IP on its own.
	host := srv.Listener.Addr().(*net.TCPAddr).IP.String()
	c := colly.NewCollector(
		colly.UserAgent(userAgent),
		colly.AllowedDomains(host),
		colly.StdlibContext(context.Background()),
		colly.AllowURLRevisit(),
	)
	c.SetRequestTimeout(5 * time.Second)
	f := &Fetcher{collector: c, policy: policy, log: discardLogger()}
	f.wireHandlers()
	return f, srv.URL
}

func TestGetReturnsBody(t *testing.T) {
	f, base := newFetcherAt(t, Defaults{}.Policy(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "deck page")
	}))
	body, err := f.Get(context.Background(), base+"/deck")
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "deck page" {
		t.Fatalf("got %q", body)
	}
}

func TestGetBlockedOn403(t *testing.T) {
	f, base := newFetcherAt(t, Defaults{}.Policy(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "blocked", http.StatusForbidden)
	}))
	_, err := f.Get(context.Background(), base+"/deck")
	var blocked *Blocked
	if !errors.As(err, &blocked) {
		t.Fatalf("want a Blocked error, got %v", err)
	}
}

func TestGetBlockedOnChallengeBody(t *testing.T) {
	// A Cloudflare managed challenge can answer 200 with the JS challenge inside; that is still a wall.
	f, base := newFetcherAt(t, Defaults{}.Policy(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><script src="/challenge-platform/h/b/gt/js" ></script></html>`)
	}))
	_, err := f.Get(context.Background(), base+"/deck")
	var blocked *Blocked
	if !errors.As(err, &blocked) {
		t.Fatalf("want a Blocked error, got %v", err)
	}
}

func TestGetRetriesTransient(t *testing.T) {
	var hits atomic.Int32
	policy := Defaults{}.Policy()
	policy.BackoffStart = 2 * time.Millisecond
	policy.BackoffMax = 4 * time.Millisecond

	f, base := newFetcherAt(t, policy, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits.Add(1) < 3 {
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprint(w, "recovered")
	}))
	body, err := f.Get(context.Background(), base+"/deck")
	if err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 3 {
		t.Fatalf("got %d hits, want 3 (retried twice)", hits.Load())
	}
	if string(body) != "recovered" {
		t.Fatalf("got %q", body)
	}
}

func TestGetHonorsRetryAfter(t *testing.T) {
	var first atomic.Bool
	f, base := newFetcherAt(t, Defaults{}.Policy(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !first.Swap(true) {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "slow down", http.StatusTooManyRequests)
			return
		}
		fmt.Fprint(w, "ok")
	}))

	start := time.Now()
	if _, err := f.Get(context.Background(), base+"/deck"); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed < 800*time.Millisecond {
		t.Fatalf("Retry-After was not honored: elapsed %v", elapsed)
	}
}

// A challenge wall is an HTML interstitial or a labelled Cloudflare response. It is deliberately not "any body
// containing the word": the active source answers JSON, a single false positive disables that source until a human
// clears it by hand, and deck and card names are user-written text that reaches these bodies.
func TestChallengeDetection(t *testing.T) {
	html := func() *http.Header {
		h := http.Header{}
		h.Set("Content-Type", "text/html; charset=utf-8")
		return &h
	}
	json := func() *http.Header {
		h := http.Header{}
		h.Set("Content-Type", "application/json")
		return &h
	}
	mitigated := func() *http.Header {
		h := json()
		h.Set("cf-mitigated", "challenge")
		return h
	}

	for _, tc := range []struct {
		name    string
		headers *http.Header
		body    string
		want    bool
	}{
		{"a Cloudflare interstitial", html(), `<html><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>`, true},
		{"the Just a moment page", html(), `<html><head><title>Just a moment...</title></head>`, true},
		{"a labelled response, whatever the body", mitigated(), `{"results":[]}`, true},
		{"a deck list that mentions a challenge", json(), `{"results":[{"name":"Just a moment... challenge-platform"}]}`, false},
		{"an ordinary deck page", json(), `{"deckFormat":3}`, false},
		{"an ordinary HTML page", html(), `<html><body>decks</body></html>`, false},
		{"no headers at all", nil, `challenge-platform`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := isChallenge(tc.headers, []byte(tc.body)); got != tc.want {
				t.Fatalf("isChallenge = %v, want %v", got, tc.want)
			}
		})
	}
}

// The jitter only ever lengthens the gap: each slot is at least the interval after the last, and less than the
// interval plus the jitter.
func TestPaceJitterStaysWithinItsBounds(t *testing.T) {
	const interval, spread = 10 * time.Millisecond, 20 * time.Millisecond
	f := &Fetcher{policy: Policy{RequestInterval: interval, RequestJitter: spread}}
	if err := f.pace(context.Background()); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		before := f.nextSlot
		if err := f.pace(context.Background()); err != nil {
			t.Fatal(err)
		}
		if gap := f.nextSlot.Sub(before); gap < interval || gap >= interval+spread {
			t.Fatalf("gap %v outside [%v, %v)", gap, interval, interval+spread)
		}
	}
}

// The pace adapts: a 429 widens it, and enough clean responses bring it back. A fixed pace has to be slow enough for
// the worst day; this one is fast on the good days and backs off on the evidence.
func TestThePaceWidensOnPushbackAndRecovers(t *testing.T) {
	const base, ceiling = time.Second, 4 * time.Second
	f := &Fetcher{policy: Policy{RequestInterval: base, RequestIntervalMax: ceiling, PaceRecoverRequests: 3}, interval: base}

	if _, next, capped := f.throttled(); next != 2*time.Second || capped {
		t.Fatalf("first 429: %v capped=%v", next, capped)
	}
	if _, next, _ := f.throttled(); next != ceiling {
		t.Fatalf("second 429 should reach the ceiling: %v", next)
	}
	if _, next, capped := f.throttled(); next != ceiling || !capped {
		t.Fatalf("the pace must stop doubling at the ceiling: %v capped=%v", next, capped)
	}
	if f.Throttles() != 3 {
		t.Fatalf("throttles: %d", f.Throttles())
	}

	// Short of the recovery threshold nothing changes, so the crawl is not re-testing the limit every other request.
	if restored := f.succeeded(); restored != 0 {
		t.Fatalf("recovered too early: %v", restored)
	}
	f.succeeded()
	if restored := f.succeeded(); restored != base {
		t.Fatalf("expected a return to the base pace, got %v", restored)
	}
	if f.currentInterval() != base {
		t.Fatalf("interval: %v", f.currentInterval())
	}
	// Already at the base: further successes are not counted toward anything.
	if restored := f.succeeded(); restored != 0 {
		t.Fatalf("recovered from the base pace: %v", restored)
	}
}

// A run starts at the base pace: carrying a throttled interval across runs would let one bad minute slow every crawl
// until the process restarted.
func TestANewRunStartsAtTheBasePace(t *testing.T) {
	f := &Fetcher{policy: Policy{RequestInterval: time.Second, RequestIntervalMax: 8 * time.Second}, interval: time.Second}
	f.throttled()
	f.SetPolicy(Policy{RequestInterval: time.Second, RequestIntervalMax: 8 * time.Second})
	if f.currentInterval() != time.Second {
		t.Fatalf("interval: %v", f.currentInterval())
	}
}

// An unset interval must never mean "as fast as possible" against somebody else's site.
func TestAnUnsetIntervalFallsBackToThePolicy(t *testing.T) {
	f := &Fetcher{policy: Policy{RequestInterval: 2 * time.Second}}
	if f.currentInterval() != 2*time.Second {
		t.Fatalf("interval: %v", f.currentInterval())
	}
}
