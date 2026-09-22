package crawl

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocolly/colly/v2"
)

// The app's honest request identity, matching apps/worker/src/lib/config.ts. Never rotated or spoofed.
const userAgent = "MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)"

const (
	fetchTimeout    = 30 * time.Second
	maxFetchRetries = 3
)

// The markers of a challenge page served inside an otherwise ordinary response. Matched only against HTML: the
// active source answers JSON, and a substring search over any body would let a deck called "Just a moment" or a
// card named in an article disable the crawl permanently. A 403 is judged by its status, not by these.
var challengeMarkers = []string{"challenge-platform", "cf-browser-verification", "just a moment..."}

// Getter is what the run loop needs from a crawler, so the loop can be tested with a scripted fake. *Fetcher
// implements it.
type Getter interface {
	Get(ctx context.Context, rawurl string) ([]byte, error)
	// SetPolicy hands the run's effective policy (from app_config) to the fetcher before it starts.
	SetPolicy(p Policy)
}

// Blocked matches a 403 or a Cloudflare challenge wall: the one response that must never be retried or worked
// around. The run counts it and disables the source until a human re-enables it.
type Blocked struct {
	URL string
}

func (b *Blocked) Error() string {
	return fmt.Sprintf("the source blocked %s (403 or challenge)", b.URL)
}

// HTTPError carries status and any Retry-After so the retry loop can honor server pacing, not just its own.
type HTTPError struct {
	Status     int
	RetryAfter time.Duration
	URL        string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("HTTP %d for %s", e.Status, e.URL) }

// ShapeError means a page stopped looking like what the crawler was written against. Quarantine, don't guess: a
// removed or renamed endpoint should stop the crawl, not be guessed at.
type ShapeError struct {
	What   string
	Detail string
}

func (e *ShapeError) Error() string {
	return fmt.Sprintf("%s response changed shape: %s", e.What, e.Detail)
}

// Fetcher is a bounded, single-flight fetcher of one source's pages: honest User-Agent, robots.txt obeyed, one
// request at a time at the policy spacing, exponential backoff honoring Retry-After, and a hard stop on a 403 or
// challenge wall. It fetches one URL per call, so the crawl's own loops decide the order.
type Fetcher struct {
	collector *colly.Collector
	policy    Policy
	log       *slog.Logger

	// Spacing: the same shape as the worker's RateLimiter (apps/worker/src/lib/http.ts) - requests to one host keep
	// at least RequestInterval between their starts, across the crawl's sequential calls.
	mu       sync.Mutex
	nextSlot time.Time
	gotBody  []byte
	gotErr   error
}

// NewFetcher stands one up for the given host. domains are the hostnames (plus any alias like www.) the crawl may
// visit; robots.txt is obeyed by default, so disallowed paths are refused rather than trusted to remember.
func NewFetcher(domains []string, policy Policy, log *slog.Logger) *Fetcher {
	// Robots.txt is obeyed by default: the IgnoreRobotsTxt option is absent on purpose. The collector's context is
	// background because colly v2 offers no per-request context and the run loop checks ctx.Err() between fetches; a
	// request in flight is bounded by fetchTimeout either way.
	c := colly.NewCollector(
		colly.UserAgent(userAgent),
		colly.AllowedDomains(domains...),
		colly.StdlibContext(context.Background()),
		colly.MaxDepth(1),
		// The run's own loop retries a URL on 429/5xx; colly must not dedupe that revisit.
		colly.AllowURLRevisit(),
	)
	c.SetRequestTimeout(fetchTimeout)

	f := &Fetcher{collector: c, policy: policy, log: log}
	f.wireHandlers()
	return f
}

// wireHandlers installs the response and error paths. Kept separate from NewFetcher so tests can stand the same
// handlers up against a loopback server.
func (f *Fetcher) wireHandlers() {
	c := f.collector
	c.OnResponse(func(r *colly.Response) {
		if isChallenge(r.Headers, r.Body) {
			// A 200 that is really a challenge counts as blocked too; colly calls OnResponse, not OnError, for it.
			f.mu.Lock()
			if f.gotErr == nil {
				f.gotErr = &Blocked{URL: r.Request.URL.String()}
			}
			f.mu.Unlock()
			return
		}
		f.mu.Lock()
		f.gotBody = r.Body
		f.mu.Unlock()
	})
	c.OnError(func(r *colly.Response, err error) {
		if r.StatusCode == 403 || isChallenge(r.Headers, r.Body) {
			f.mu.Lock()
			if f.gotErr == nil {
				f.gotErr = &Blocked{URL: r.Request.URL.String()}
			}
			f.mu.Unlock()
			return
		}
		he := &HTTPError{Status: r.StatusCode, URL: r.Request.URL.String()}
		if ra := r.Headers.Get("Retry-After"); ra != "" {
			if secs, conv := strconv.Atoi(ra); conv == nil && secs > 0 {
				he.RetryAfter = time.Duration(secs) * time.Second
			}
		}
		f.mu.Lock()
		f.gotErr = he
		f.mu.Unlock()
	})
}

// isChallenge reports a bot wall dressed as an ordinary response. Cloudflare labels one outright with
// `cf-mitigated: challenge`; otherwise it is an HTML interstitial, so the body is only searched when the response
// claims to be HTML.
func isChallenge(headers *http.Header, body []byte) bool {
	if headers != nil && strings.EqualFold(strings.TrimSpace(headers.Get("cf-mitigated")), "challenge") {
		return true
	}
	if len(body) == 0 || headers == nil {
		return false
	}
	if contentType := headers.Get("Content-Type"); !strings.Contains(strings.ToLower(contentType), "html") {
		return false
	}
	lowered := strings.ToLower(string(body))
	for _, marker := range challengeMarkers {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}

// SetPolicy updates the politeness and backoff for a run. Only the runner calls it, before crawling starts.
func (f *Fetcher) SetPolicy(p Policy) {
	f.mu.Lock()
	f.policy = p
	f.mu.Unlock()
}

// Get pulls one page with backoff. A 403/challenge returns a Blocked error without retrying; 429 and 5xx retry up
// to maxFetchRetries times with exponential backoff, widening to the Retry-After value when the server sets one.
func (f *Fetcher) Get(ctx context.Context, rawurl string) ([]byte, error) {
	delay := f.policy.BackoffStart
	var lastErr error
	for attempt := 0; attempt <= maxFetchRetries; attempt++ {
		if attempt > 0 {
			if err := sleepCtx(ctx, delay); err != nil {
				return nil, err
			}
			if delay < f.policy.BackoffMax {
				delay *= 2
			}
		}
		body, err := f.visit(ctx, rawurl)
		if err == nil {
			return body, nil
		}
		var blocked *Blocked
		if errors.As(err, &blocked) {
			return nil, blocked
		}
		var httpErr *HTTPError
		if errors.As(err, &httpErr) {
			if httpErr.Status != 429 && httpErr.Status < 500 {
				return nil, err
			}
			if httpErr.RetryAfter > 0 {
				delay = httpErr.RetryAfter
			}
			lastErr = httpErr
			f.log.Warn("source pushback", "status", httpErr.Status, "url", httpErr.URL, "attempt", attempt+1)
			continue
		}
		lastErr = err
		f.log.Warn("fetch failed", "err", err, "url", rawurl, "attempt", attempt+1)
	}
	return nil, lastErr
}

// visit performs one synchronous page fetch. There is only ever one in flight, so the shared body slot needs no
// matching against the URL.
func (f *Fetcher) visit(ctx context.Context, rawurl string) ([]byte, error) {
	f.mu.Lock()
	f.gotBody = nil
	f.gotErr = nil
	f.mu.Unlock()

	if err := f.pace(ctx); err != nil {
		return nil, err
	}
	if err := f.collector.Visit(rawurl); err != nil {
		if got := f.fetchError(); got != nil {
			return nil, got
		}
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gotBody, f.gotErr
}

// pace keeps request starts at least RequestInterval apart, the worker's RateLimiter shape.
func (f *Fetcher) pace(ctx context.Context) error {
	var wait time.Duration
	f.mu.Lock()
	now := time.Now()
	if now.Before(f.nextSlot) {
		wait = f.nextSlot.Sub(now)
	} else {
		f.nextSlot = now
	}
	f.nextSlot = f.nextSlot.Add(f.policy.RequestInterval)
	f.mu.Unlock()
	return sleepCtx(ctx, wait)
}

func (f *Fetcher) fetchError() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gotErr
}

// sleepCtx is time.Sleep that honours cancellation, so a shutdown ends a backoff wait promptly.
func sleepCtx(ctx context.Context, d time.Duration) error {
	select {
	case <-time.After(d):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
