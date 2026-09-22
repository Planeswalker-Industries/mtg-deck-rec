package supabase

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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

	rows, err := c.SelectAll(context.Background(), "corpus.decks", "source_deck_id,content_hash", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != MaxRowsPerRequest+5 {
		t.Fatalf("got %d rows, want %d", len(rows), MaxRowsPerRequest+5)
	}
	if len(f.paths) != 2 {
		t.Fatalf("got %d requests, want 2 (full page + tail)", len(f.paths))
	}
	if !strings.HasPrefix(f.paths[0], "GET /rest/v1/corpus.decks?") {
		t.Fatalf("unexpected first request: %s", f.paths[0])
	}
}

func TestSelectAllEncodesTheFilter(t *testing.T) {
	f := newFakeDB(t, 3)
	c := newClient(f)

	_, err := c.SelectAll(context.Background(), "corpus.decks", "source_deck_id", `source_deck_id=in.("a b","c)")`)
	if err != nil {
		t.Fatal(err)
	}
	got := f.paths[0]
	for _, want := range []string{"select=source_deck_id", "source_deck_id=in.", "a+b", "c%29"} {
		if !strings.Contains(got, want) {
			t.Fatalf("%q is missing %q", got, want)
		}
	}
}

func TestUpsertSendsTheMergePreferenceAndConflictColumns(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)

	rows := []map[string]any{{"source_deck_id": "abc123"}}
	if err := c.Upsert(context.Background(), "corpus.decks", rows, []string{"source", "source_deck_id"}); err != nil {
		t.Fatal(err)
	}
	if len(f.paths) != 1 || !strings.HasPrefix(f.paths[0], "POST /rest/v1/corpus.decks?on_conflict=source,source_deck_id") {
		t.Fatalf("got %v", f.paths)
	}
	if len(f.prefers) != 1 || f.prefers[0] != "resolution=merge-duplicates" {
		t.Fatalf("Prefer header: %v", f.prefers)
	}
}

func TestUpdatePatchesTheMatchingRow(t *testing.T) {
	f := newFakeDB(t, 0)
	c := newClient(f)

	row := map[string]any{"next_page": 4}
	if err := c.Update(context.Background(), "corpus.crawl_state", "id=eq.1", row); err != nil {
		t.Fatal(err)
	}
	if len(f.paths) != 1 || !strings.HasPrefix(f.paths[0], "PATCH /rest/v1/corpus.crawl_state?id=eq.1") {
		t.Fatalf("got %v", f.paths)
	}
	if len(f.prefers) != 1 || f.prefers[0] != "return=representation" {
		t.Fatalf("Prefer header: %v", f.prefers)
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
