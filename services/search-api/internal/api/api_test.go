package api_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/wuddat/mtg-deck-rec/services/search-api/internal/api"
	"github.com/wuddat/mtg-deck-rec/services/search-api/internal/config"
	"github.com/wuddat/mtg-deck-rec/services/search-api/internal/typesense"
)

const (
	readToken  = "read-token"
	adminToken = "admin-token"
)

// fakeTypesense stands in for the real thing and records what it was asked, so the tests can assert on the requests
// this service builds - the chunking, the filters and the ranking are the parts worth pinning down.
type fakeTypesense struct {
	server   *httptest.Server
	searches []typesense.SearchParams
	requests []string
	respond  func(searches []typesense.SearchParams) []typesense.SearchResult
}

func newFakeTypesense(t *testing.T) *fakeTypesense {
	t.Helper()
	f := &fakeTypesense{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.requests = append(f.requests, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")

		switch {
		case r.URL.Path == "/health":
			fmt.Fprint(w, `{"ok":true}`)
		case r.URL.Path == "/multi_search":
			var body struct {
				Searches []typesense.SearchParams `json:"searches"`
			}
			payload, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(payload, &body)
			f.searches = append(f.searches, body.Searches...)
			results := []typesense.SearchResult{}
			if f.respond != nil {
				results = f.respond(body.Searches)
			} else {
				for range body.Searches {
					results = append(results, typesense.SearchResult{})
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"results": results})
		case strings.HasSuffix(r.URL.Path, "/documents/import"):
			fmt.Fprint(w, "{\"success\":true}\n{\"success\":false,\"error\":\"bad document\"}\n")
		case r.URL.Path == "/collections":
			fmt.Fprint(w, `[{"name":"cards","num_documents":3}]`)
		default:
			fmt.Fprint(w, `{}`)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func newApp(t *testing.T, fake *fakeTypesense) *fiber.App {
	t.Helper()
	cfg := config.Config{ReadToken: readToken, AdminToken: adminToken}
	client := typesense.New(fake.server.URL, "key", 5*time.Second)
	return api.New(cfg, client, discardLogger())
}

func do(t *testing.T, app *fiber.App, method, path, token, body string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := app.Test(req, fiber.TestConfig{Timeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	var decoded map[string]any
	payload, _ := io.ReadAll(res.Body)
	_ = json.Unmarshal(payload, &decoded)
	return res, decoded
}

func hit(document string) typesense.Hit { return typesense.Hit{Document: json.RawMessage(document)} }

func TestAuthorization(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	cases := []struct {
		name, method, path, token string
		want                      int
	}{
		{"health needs no token", http.MethodGet, "/v1/health", "", http.StatusOK},
		{"liveness needs no token", http.MethodGet, "/v1/health/live", "", http.StatusOK},
		{"a read endpoint without a token", http.MethodGet, "/v1/tags", "", http.StatusUnauthorized},
		{"a read endpoint with a wrong token", http.MethodGet, "/v1/tags", "nonsense", http.StatusForbidden},
		{"a read endpoint with the read token", http.MethodGet, "/v1/tags", readToken, http.StatusOK},
		{"an admin endpoint with the read token", http.MethodGet, "/v1/admin/collections", readToken, http.StatusForbidden},
		{"an admin endpoint with the admin token", http.MethodGet, "/v1/admin/collections", adminToken, http.StatusOK},
		// The admin token is strictly more privileged, so it may also read.
		{"a read endpoint with the admin token", http.MethodGet, "/v1/tags", adminToken, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, _ := do(t, app, tc.method, tc.path, tc.token, "")
			if res.StatusCode != tc.want {
				t.Fatalf("got %d, want %d", res.StatusCode, tc.want)
			}
		})
	}
}

// Liveness must not depend on Typesense: the container healthcheck asks it, and a dependency outage that marks the
// API unhealthy gets it restart-looped and pulled out of the router over a 503 the app already falls back from.
func TestLivenessIgnoresTypesense(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)
	fake.server.Close() // Typesense is now unreachable.

	res, decoded := do(t, app, http.MethodGet, "/v1/health/live", "", "")
	if res.StatusCode != http.StatusOK || decoded["ok"] != true {
		t.Fatalf("liveness should not care: %d %v", res.StatusCode, decoded)
	}

	ready, _ := do(t, app, http.MethodGet, "/v1/health", "", "")
	if ready.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("readiness should report the outage, got %d", ready.StatusCode)
	}
}

func TestCardsByIDChunksToTypesensePageLimit(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	ids := make([]int, 600)
	for i := range ids {
		ids[i] = i + 1
	}
	body, _ := json.Marshal(map[string]any{"ids": ids})

	res, _ := do(t, app, http.MethodPost, "/v1/cards/by-id", readToken, string(body))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("got %d", res.StatusCode)
	}
	// 600 ids over a 250-document page ceiling is three searches - and one request, which is the point.
	if len(fake.searches) != 3 {
		t.Fatalf("got %d searches, want 3", len(fake.searches))
	}
	if got := countRequests(fake.requests, "POST /multi_search"); got != 1 {
		t.Fatalf("got %d round trips to Typesense, want 1", got)
	}
	if !strings.HasPrefix(fake.searches[0].FilterBy, "card_id:[1,2,3,") {
		t.Fatalf("unexpected filter: %s", fake.searches[0].FilterBy)
	}
}

func TestCardsByIDRejectsAnAbsurdRequest(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	ids := make([]int, 2001)
	body, _ := json.Marshal(map[string]any{"ids": ids})
	res, decoded := do(t, app, http.MethodPost, "/v1/cards/by-id", readToken, string(body))
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d, want 400", res.StatusCode)
	}
	if !strings.Contains(fmt.Sprint(decoded["error"]), "2000") {
		t.Fatalf("the error should say the limit: %v", decoded["error"])
	}
	if len(fake.searches) != 0 {
		t.Fatal("nothing should have reached Typesense")
	}
}

func TestCardsSearchRanking(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	do(t, app, http.MethodGet, "/v1/cards/search?q=smothering&limit=5", readToken, "")
	if len(fake.searches) != 1 {
		t.Fatalf("got %d searches", len(fake.searches))
	}
	got := fake.searches[0]
	// name_head above name above names is the "starts with beats contains" tier; without it Typesense scores by
	// token and not by position, and Rug of Smothering ties with Smothering Abomination.
	if got.QueryBy != "name_head,name,names" || got.QueryByWeights != "5,3,1" {
		t.Fatalf("ranking fields changed: %s / %s", got.QueryBy, got.QueryByWeights)
	}
	if got.SortBy != "_text_match:desc,commander_deck_count:desc,staple_score:desc" {
		t.Fatalf("sort changed: %s", got.SortBy)
	}
	if got.FilterBy != "" {
		t.Fatalf("no commander filter was asked for: %s", got.FilterBy)
	}
	if got.PerPage != 5 {
		t.Fatalf("limit not honoured: %d", got.PerPage)
	}
}

func TestCardsSearchCommanderOnly(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	do(t, app, http.MethodGet, "/v1/cards/search?q=atraxa&commanderOnly=1", readToken, "")
	if fake.searches[0].FilterBy != "can_be_commander:=true && legal_commander:=legal" {
		t.Fatalf("got %q", fake.searches[0].FilterBy)
	}
}

func TestPageExists(t *testing.T) {
	fake := newFakeTypesense(t)
	fake.respond = func(searches []typesense.SearchParams) []typesense.SearchResult {
		if strings.Contains(searches[0].FilterBy, "sol-ring") {
			return []typesense.SearchResult{{Found: 1, Hits: []typesense.Hit{hit(`{"slug":"sol-ring"}`)}}}
		}
		return []typesense.SearchResult{{Found: 0}}
	}
	app := newApp(t, fake)

	_, found := do(t, app, http.MethodGet, "/v1/pages/card/sol-ring", readToken, "")
	if found["exists"] != true {
		t.Fatalf("expected the card to exist: %v", found)
	}

	_, missing := do(t, app, http.MethodGet, "/v1/pages/card/not-a-card", readToken, "")
	if missing["exists"] != false {
		t.Fatalf("expected a miss: %v", missing)
	}

	// A slug the catalog could never produce is answered without asking Typesense at all, so no caller input
	// reaches a filter expression.
	for _, odd := range []string{
		"Sol-Ring",                 // uppercase: slugs are lower-case
		"sol%20ring",               // a space
		"sol-ring%20%26%26%20true", // an attempt at a second filter clause
	} {
		before := len(fake.searches)
		_, decoded := do(t, app, http.MethodGet, "/v1/pages/card/"+odd, readToken, "")
		if decoded["exists"] != false {
			t.Fatalf("%q: expected a miss, got %v", odd, decoded)
		}
		if len(fake.searches) != before {
			t.Fatalf("%q reached Typesense", odd)
		}
	}

	res, _ := do(t, app, http.MethodGet, "/v1/pages/spaceship/sol-ring", readToken, "")
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown kind should be refused, got %d", res.StatusCode)
	}
}

func TestAllTagsPagesUntilItHasThemAll(t *testing.T) {
	fake := newFakeTypesense(t)
	total := 600
	fake.respond = func(searches []typesense.SearchParams) []typesense.SearchResult {
		page := searches[0].Page
		remaining := total - (page-1)*250
		size := min(250, max(remaining, 0))
		hits := make([]typesense.Hit, size)
		for i := range hits {
			hits[i] = hit(fmt.Sprintf(`{"id":"tag-%d"}`, (page-1)*250+i))
		}
		return []typesense.SearchResult{{Found: total, Hits: hits}}
	}
	app := newApp(t, fake)

	_, decoded := do(t, app, http.MethodGet, "/v1/tags", readToken, "")
	tags, _ := decoded["tags"].([]any)
	if len(tags) != total {
		t.Fatalf("got %d tags, want %d", len(tags), total)
	}
}

func TestCommanderCardsTopIsOrderedAndDeduplicated(t *testing.T) {
	fake := newFakeTypesense(t)
	fake.respond = func(searches []typesense.SearchParams) []typesense.SearchResult {
		// The same card played by two commander keys comes back twice; the answer is a ranked list of cards.
		return []typesense.SearchResult{{
			Found: 3,
			Hits:  []typesense.Hit{hit(`{"card_id":7}`), hit(`{"card_id":3}`), hit(`{"card_id":7}`)},
		}}
	}
	app := newApp(t, fake)

	_, decoded := do(t, app, http.MethodGet, "/v1/commander-cards/top?keyIds=1,2&limit=10", readToken, "")
	ids, _ := decoded["cardIds"].([]any)
	if len(ids) != 2 || ids[0].(float64) != 7 || ids[1].(float64) != 3 {
		t.Fatalf("got %v, want [7 3]", ids)
	}
	if fake.searches[0].SortBy != "inclusion_shrunk:desc" {
		t.Fatalf("got %q", fake.searches[0].SortBy)
	}
	if fake.searches[0].IncludeFields != "card_id" {
		t.Fatalf("only the id is needed: %q", fake.searches[0].IncludeFields)
	}
}

func TestCommanderCardRatesFansOutOverKeysAndChunks(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	ids := make([]int, 300)
	for i := range ids {
		ids[i] = i + 1
	}
	body, _ := json.Marshal(map[string]any{"keyIds": []int{11, 22}, "cardIds": ids})
	do(t, app, http.MethodPost, "/v1/commander-cards/rates", readToken, string(body))

	// 300 cards is two chunks, times two keys.
	if len(fake.searches) != 4 {
		t.Fatalf("got %d searches, want 4", len(fake.searches))
	}
	if !strings.HasPrefix(fake.searches[0].FilterBy, "key_id:=11 && card_id:[") {
		t.Fatalf("got %q", fake.searches[0].FilterBy)
	}
	if got := countRequests(fake.requests, "POST /multi_search"); got != 1 {
		t.Fatalf("got %d round trips, want 1", got)
	}
}

func TestImportReportsRejectedDocuments(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	// The import endpoint answers 200 with one JSON object per line, so a rejected document passes silently
	// unless the body is read line by line.
	_, decoded := do(t, app, http.MethodPost, "/v1/admin/collections/cards/import", adminToken,
		"{\"id\":\"1\"}\n{\"id\":\"2\"}\n")
	if decoded["imported"].(float64) != 1 {
		t.Fatalf("got %v imported", decoded["imported"])
	}
	failures, _ := decoded["failures"].([]any)
	if len(failures) != 1 || failures[0] != "bad document" {
		t.Fatalf("got %v", failures)
	}
}

func TestAdminRejectsNamesThatCouldEscapeAPath(t *testing.T) {
	fake := newFakeTypesense(t)
	app := newApp(t, fake)

	for _, name := range []string{"../aliases/cards", "cards/documents", "cards%2Fx"} {
		res, _ := do(t, app, http.MethodDelete, "/v1/admin/collections/"+name, adminToken, "")
		if res.StatusCode == http.StatusOK {
			t.Fatalf("%q was accepted", name)
		}
	}
}

func countRequests(requests []string, want string) int {
	n := 0
	for _, r := range requests {
		if r == want {
			n++
		}
	}
	return n
}
