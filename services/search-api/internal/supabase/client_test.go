package supabase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeDB stands in for PostgREST and records what it was asked, so the tests can pin the REST shapes the crawl
// depends on: paging, the upsert headers and the update filter.
type fakeDB struct {
	server  *httptest.Server
	paths   []string
	prefers []string
	upserts []json.RawMessage
	patches []json.RawMessage
	rows    int // total rows SelectAll sees before the table "runs out"
}

func newFakeDB(t *testing.T, rows int) *fakeDB {
	t.Helper()
	f := &fakeDB{rows: rows}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") == "" || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			http.Error(w, "missing key", http.StatusUnauthorized)
			return
		}
		f.paths = append(f.paths, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodGet:
			offset := 0
			fmt.Sscanf(r.URL.Query().Get("offset"), "%d", &offset)
			page := []map[string]any{}
			for i := 0; i < MaxRowsPerRequest; i++ {
				if offset+i >= f.rows {
					break
				}
				page = append(page, map[string]any{"n": offset + i})
			}
			_ = json.NewEncoder(w).Encode(page)
		case http.MethodPost:
			f.prefers = append(f.prefers, r.Header.Get("Prefer"))
			body, _ := io.ReadAll(r.Body)
			f.upserts = append(f.upserts, json.RawMessage(body))
			w.WriteHeader(http.StatusCreated)
		case http.MethodPatch:
			f.prefers = append(f.prefers, r.Header.Get("Prefer"))
			body, _ := io.ReadAll(r.Body)
			f.patches = append(f.patches, json.RawMessage(body))
			fmt.Fprint(w, `[]`)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func newClient(f *fakeDB) *Client {
	return New(f.server.URL, "service-key", 5*time.Second)
}

func TestSelectAllPagesUntilTheTableRunsOut(t *testing.T) {
	f := newFakeDB(t, MaxRowsPerRequest+5)
	c := newClient(f)

	rows, err := c.SelectAll(context.Background(), "app_config", "key,value", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != MaxRowsPerRequest+5 {
		t.Fatalf("got %d rows, want %d", len(rows), MaxRowsPerRequest+5)
	}
	if len(f.paths) != 2 {
		t.Fatalf("got %d requests, want 2 (full page + tail)", len(f.paths))
	}
	if !strings.HasPrefix(f.paths[0], "GET /rest/v1/app_config?") {
		t.Fatalf("unexpected first request: %s", f.paths[0])
	}
}

func TestSelectAllEncodesTheFilter(t *testing.T) {
	f := newFakeDB(t, 3)
	c := newClient(f)

	_, err := c.SelectAll(context.Background(), "app_config", "key", `key=in.("a b","c)")`)
	if err != nil {
		t.Fatal(err)
	}
	got := f.paths[0]
	for _, want := range []string{"select=key", "key=in.", "a+b", "c%29"} {
		if !strings.Contains(got, want) {
			t.Fatalf("%q is missing %q", got, want)
		}
	}
}

// The crawl reaches the private corpus schema only through functions: PostgREST addresses tables in the schemas on
// its exposed list, and a path like /rest/v1/corpus.decks is read as a table *named* "corpus.decks" in public.
func TestRPCPostsToTheFunctionPath(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)

	var out struct {
		N int `json:"n"`
	}
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.paths = append(f.paths, r.Method+" "+r.URL.Path)
		body, _ := io.ReadAll(r.Body)
		f.upserts = append(f.upserts, json.RawMessage(body))
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"n":7}`)
	})
	if err := c.RPCInto(context.Background(), "crawl_state", map[string]any{"p_source": "archidekt"}, &out); err != nil {
		t.Fatal(err)
	}
	if len(f.paths) != 1 || f.paths[0] != "POST /rest/v1/rpc/crawl_state" {
		t.Fatalf("got %v", f.paths)
	}
	if !strings.Contains(string(f.upserts[0]), `"p_source":"archidekt"`) {
		t.Fatalf("named arguments should travel as the body: %s", f.upserts[0])
	}
	if out.N != 7 {
		t.Fatalf("result not decoded: %+v", out)
	}
}

func TestRPCReportsTheStatus(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"message":"permission denied for function crawl_state"}`)
	})

	_, err := c.RPC(context.Background(), "crawl_state", map[string]any{"p_source": "archidekt"})
	var restErr *Error
	if !errors.As(err, &restErr) || restErr.Status != http.StatusForbidden {
		t.Fatalf("want a 403 Error, got %v", err)
	}
}

// PostgREST has no "a=eq.x and b=is.null" query form: splitting such a string on its first "=" builds a filter whose
// value is the rest of the expression, which matches nothing and reads as "no rows" rather than as a mistake.
func TestSelectAllRefusesACompoundFilter(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)

	_, err := c.SelectAll(context.Background(), "app_config", "value", "source=eq.archidekt and running_run_id=is.null")
	if err == nil {
		t.Fatal("a compound filter should be refused, not silently matched against nothing")
	}
	if len(f.paths) != 0 {
		t.Fatalf("nothing should have been requested: %v", f.paths)
	}
}

// retryTestWait stands in for the production waits so the retry tests run in milliseconds.
const retryTestWait = time.Millisecond

// newScripted serves answer for each request in turn, counting them; the tests read the count to see how often the
// client tried.
func newScripted(t *testing.T, answer func(n int, w http.ResponseWriter)) (*Client, *int) {
	t.Helper()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		answer(calls, w)
	}))
	t.Cleanup(server.Close)
	c := New(server.URL, "service-key", 5*time.Second)
	c.waits = []time.Duration{retryTestWait, retryTestWait, retryTestWait}
	return c, &calls
}

// resetConnection drops the TCP connection with a reset, as a peer does when it goes away mid-request (run 63's
// "connection reset by peer").
func resetConnection(t *testing.T, w http.ResponseWriter) {
	conn, _, err := w.(http.Hijacker).Hijack()
	if err != nil {
		t.Errorf("hijack: %v", err)
		return
	}
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetLinger(0)
	}
	_ = conn.Close()
}

func answerOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"n":1}`)
}

func TestRPCRetriesADroppedConnection(t *testing.T) {
	c, calls := newScripted(t, func(n int, w http.ResponseWriter) {
		if n == 1 {
			resetConnection(t, w)
			return
		}
		answerOK(w)
	})
	var out struct {
		N int `json:"n"`
	}
	if err := c.RPCInto(context.Background(), "crawl_deck_versions", nil, &out); err != nil {
		t.Fatalf("a dropped connection should be retried: %v", err)
	}
	if *calls != 2 || out.N != 1 {
		t.Fatalf("got %d calls and %+v, want 2 calls and the second answer", *calls, out)
	}
}

func TestRPCRetriesAGatewayError(t *testing.T) {
	c, calls := newScripted(t, func(n int, w http.ResponseWriter) {
		if n == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		answerOK(w)
	})
	if _, err := c.RPC(context.Background(), "crawl_finish_commander", nil); err != nil {
		t.Fatalf("a 503 should be retried: %v", err)
	}
	if *calls != 2 {
		t.Fatalf("got %d calls, want 2", *calls)
	}
}

// A 4xx is PostgREST refusing the call itself: the same call would be refused again.
func TestRPCNeverRetriesAClientError(t *testing.T) {
	c, calls := newScripted(t, func(_ int, w http.ResponseWriter) {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"message":"bad arguments"}`)
	})
	_, err := c.RPC(context.Background(), "crawl_finish_commander", nil)
	var restErr *Error
	if !errors.As(err, &restErr) || restErr.Status != http.StatusBadRequest {
		t.Fatalf("want the 400, got %v", err)
	}
	if *calls != 1 {
		t.Fatalf("got %d calls, want 1", *calls)
	}
}

// A database that stays unreachable fails after the last retry, with the status the caller can report.
func TestRPCGivesUpAfterTheLastRetry(t *testing.T) {
	c, calls := newScripted(t, func(_ int, w http.ResponseWriter) {
		w.WriteHeader(http.StatusBadGateway)
	})
	_, err := c.RPC(context.Background(), "crawl_upsert_decks", nil)
	var restErr *Error
	if !errors.As(err, &restErr) || restErr.Status != http.StatusBadGateway {
		t.Fatalf("want the 502, got %v", err)
	}
	if want := len(c.waits) + 1; *calls != want {
		t.Fatalf("got %d calls, want %d (one try and every retry)", *calls, want)
	}
}

// crawl_create_run and log_error_event insert a row each call: a reply lost after the insert must not insert again.
func TestRPCOnceNeverRetries(t *testing.T) {
	c, calls := newScripted(t, func(n int, w http.ResponseWriter) {
		if n == 1 {
			resetConnection(t, w)
			return
		}
		answerOK(w)
	})
	var id int64
	if err := c.RPCOnceInto(context.Background(), "crawl_create_run", nil, &id); err == nil {
		t.Fatal("a dropped connection should fail a call that must not repeat")
	}
	if _, err := c.RPCOnce(context.Background(), "log_error_event", nil); err != nil {
		t.Fatalf("the next call is a new call: %v", err)
	}
	if *calls != 2 {
		t.Fatalf("got %d calls, want 2 (one per call, no retry)", *calls)
	}
}

// A run that is stopping must not sit out the retry waits.
func TestRPCStopsRetryingWhenTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	c, calls := newScripted(t, func(_ int, w http.ResponseWriter) {
		cancel()
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	c.waits = []time.Duration{time.Hour}
	_, err := c.RPC(ctx, "crawl_run_progress", nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled, got %v", err)
	}
	if *calls != 1 {
		t.Fatalf("got %d calls, want 1", *calls)
	}
}

func TestTransientStatuses(t *testing.T) {
	for status, want := range map[int]bool{
		http.StatusBadGateway:          true,
		http.StatusServiceUnavailable:  true,
		http.StatusGatewayTimeout:      true,
		cloudflareFirstOriginStatus:    true,
		cloudflareLastOriginStatus:     true,
		http.StatusInternalServerError: false, // the function itself raised: running it again raises again
		http.StatusTooManyRequests:     false,
		http.StatusNotFound:            false,
		cloudflareLastOriginStatus + 1: false,
	} {
		if got := transientStatus(status); got != want {
			t.Errorf("transientStatus(%d) = %v, want %v", status, got, want)
		}
	}
}

func TestAppConfigReadsTheValueColumn(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)

	// Repoint the fake at a static app_config answer.
	f.paths = nil
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `[{"value":{"requestIntervalMs":1000,"maxDecksPerRun":500}}]`)
	})

	got, err := c.AppConfig(context.Background(), "moxfield")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), "maxDecksPerRun") == false {
		t.Fatalf("got %s", got)
	}
}
