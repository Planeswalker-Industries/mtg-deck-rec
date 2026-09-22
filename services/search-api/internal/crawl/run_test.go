package crawl

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newFakeRunner(store Store, getter Getter, src Source) *Runner {
	return NewRunner(src, getter, store, slog.New(slog.NewTextHandler(io.Discard, nil)), "test-client")
}

// fakeSource's wire format is trivial so the run loop is what is tested: a list body is one id per line, a deck
// body is JSON with commanders, cards and updatedAt.
type fakeSource struct {
	name   string
	domain string
}

func (s fakeSource) Name() string { return s.name }
func (s fakeSource) ListURL(page int) string {
	return "https://" + s.domain + "/list?page=" + strconv.Itoa(page)
}
func (s fakeSource) DeckURL(id string) string { return "https://" + s.domain + "/deck/" + id }

func (s fakeSource) ParseList(body []byte) ([]Entry, error) {
	var ids []string
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		ids = append(ids, line)
	}
	if len(ids) == 0 {
		return nil, &ShapeError{What: "list", Detail: "empty feed"}
	}
	entries := make([]Entry, len(ids))
	for i, id := range ids {
		entries[i] = Entry{ID: id}
	}
	return entries, nil
}

func (s fakeSource) ParseDeck(body []byte, id string) (Deck, error) {
	var d struct {
		Commanders []string  `json:"commanders"`
		Cards      []string  `json:"cards"`
		UpdatedAt  time.Time `json:"updatedAt"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return Deck{}, err
	}
	return Deck{ID: id, Commanders: d.Commanders, Cards: d.Cards, UpdatedAt: d.UpdatedAt}, nil
}

func deckBody(updated string, commanders, cards []string) []byte {
	payload, _ := json.Marshal(map[string]any{
		"commanders": commanders,
		"cards":      cards,
		"updatedAt":  updated,
	})
	return payload
}

// fakeGetter answers known URLs from a fixture map, or stands in for a wall.
type fakeGetter struct {
	pages    map[string][]byte
	blockAll bool
	policy   Policy
	requests map[string]int
}

func (g *fakeGetter) Get(_ context.Context, rawurl string) ([]byte, error) {
	if g.requests == nil {
		g.requests = map[string]int{}
	}
	g.requests[rawurl]++
	if g.blockAll {
		return nil, &Blocked{URL: rawurl}
	}
	if body, ok := g.pages[rawurl]; ok {
		return body, nil
	}
	return nil, fmt.Errorf("no fixture for %s", rawurl)
}

func (g *fakeGetter) SetPolicy(p Policy) { g.policy = p }

type fakeStore struct {
	policy         Policy
	state          CrawlState
	existing       map[string]DeckRow
	upserts        []DeckRow
	runID          int64
	created        int
	finished       []RunSummary
	claimed        string // clientID when claimed, "" when released
	probeOK        bool
	disabledReason string
	claimLoses     bool
}

func (s *fakeStore) Policy(context.Context) (Policy, error)         { return s.policy, nil }
func (s *fakeStore) CrawlState(context.Context) (CrawlState, error) { return s.state, nil }
func (s *fakeStore) ExistingDecks(context.Context) (map[string]DeckRow, error) {
	return s.existing, nil
}
func (s *fakeStore) UpsertDecks(_ context.Context, rows []DeckRow) error {
	s.upserts = append(s.upserts, rows...)
	return nil
}
func (s *fakeStore) CreateRun(context.Context) (int64, error) {
	s.created++
	s.runID++
	return s.runID, nil
}
func (s *fakeStore) FinishRun(_ context.Context, runID int64, summary RunSummary) error {
	s.finished = append(s.finished, summary)
	return nil
}
func (s *fakeStore) Claim(_ context.Context, runID int64, clientID string) (bool, error) {
	if s.claimLoses {
		return false, nil
	}
	s.claimed = clientID
	return true, nil
}
func (s *fakeStore) ReleaseClaim(context.Context) error { s.claimed = ""; return nil }
func (s *fakeStore) SetProbeOK(context.Context) error   { s.probeOK = true; return nil }
func (s *fakeStore) Disable(_ context.Context, reason string) error {
	s.disabledReason = reason
	return nil
}

func newRunner(store *fakeStore, getter *fakeGetter) *Runner {
	return newFakeRunner(store, getter, fakeSource{name: "src", domain: "src.test"})
}

func TestRunIsBusyWhileAnotherRuns(t *testing.T) {
	store := &fakeStore{state: CrawlState{RunningRunID: 7}, policy: Defaults{}.Policy()}
	res, err := newRunner(store, &fakeGetter{}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.AlreadyBusy || store.created != 0 {
		t.Fatalf("busy run should be a no-op: %+v, created=%d", res, store.created)
	}
}

// Two crons that both pass the fast-path check are settled by the store's atomic claim: the loser reports busy.
func TestRunLosesTheAtomicClaimIsBusy(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy(), claimLoses: true}
	res, err := newRunner(store, &fakeGetter{}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.AlreadyBusy {
		t.Fatalf("should report busy after losing the claim: %+v", res)
	}
	if store.claimed != "" {
		t.Fatalf("loser must not hold the claim: %q", store.claimed)
	}
	if len(store.finished) != 1 || store.finished[0].State != "failed" {
		t.Fatalf("the loser's own run row should be closed failed: %+v", store.finished)
	}
}

func TestRunDisabledIsANoop(t *testing.T) {
	store := &fakeStore{state: CrawlState{Disabled: true, DisabledReason: "Cloudflare"}, policy: Defaults{}.Policy()}
	res, err := newRunner(store, &fakeGetter{}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if store.created != 0 || res.Summary.State != "failed" {
		t.Fatalf("disabled run should create nothing: %+v, created=%d", res, store.created)
	}
}

func TestRunBackfillsAndWritesTheListedDecks(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	src := fakeSource{name: "src", domain: "src.test"}
	store.policy.BackfillDecks = 2 // budget equals the two decks on page one, so the crawl stops after it
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):     []byte("111\n222\n"),
		src.DeckURL("111"): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, []string{"aaa"}),
		src.DeckURL("222"): deckBody("2026-09-20T01:00:00Z", []string{"com2"}, []string{"bbb"}),
	}}

	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "succeeded" {
		t.Fatalf("state: %+v", res.Summary)
	}
	if res.Summary.DecksWritten != 2 || len(store.upserts) != 2 {
		t.Fatalf("wrote %d upserts, summary %+v", len(store.upserts), res.Summary)
	}
	if !store.probeOK {
		t.Fatal("probe should be recorded")
	}
	if store.claimed != "" {
		t.Fatalf("claim not released: %q", store.claimed)
	}
	if len(store.finished) != 1 || store.finished[0].State != "succeeded" {
		t.Fatalf("run not finished: %+v", store.finished)
	}
	if got := store.upserts[0].ContentHash; got != contentHash([]string{"com1"}, []string{"aaa"}) {
		t.Fatalf("hash: %s", got)
	}
}

func TestRunSkipsDecksItAlreadyHolds(t *testing.T) {
	slugA := "111"
	store := &fakeStore{
		policy: Defaults{}.Policy(),
		existing: map[string]DeckRow{
			slugA: {SourceDeckID: slugA, Commanders: []string{"com1"}, Cards: []string{"aaa"}, ContentHash: contentHash([]string{"com1"}, []string{"aaa"})},
		},
	}
	store.policy.MaxDecksPerRun = 2 // one unchanged + one new, then the budget stops the crawl
	src := fakeSource{name: "src", domain: "src.test"}
	slugB := "222"
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):     []byte("111\n222\n"),
		src.DeckURL(slugA): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, []string{"aaa"}),
		src.DeckURL(slugB): deckBody("2026-09-21T00:00:00Z", []string{"com2"}, []string{"bbb"}),
	}}

	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.SkippedUnchanged != 1 {
		t.Fatalf("skipped: %+v", res.Summary)
	}
	if len(store.upserts) != 1 || store.upserts[0].SourceDeckID != slugB {
		t.Fatalf("only the new deck should be written: %+v", store.upserts)
	}
}

func TestProbeBlockDisablesTheSource(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy(), state: CrawlState{}}
	res, err := newRunner(store, &fakeGetter{blockAll: true}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if store.disabledReason == "" || res.Summary.State != "failed" {
		t.Fatalf("should have disabled: reason=%q summary=%+v", store.disabledReason, res.Summary)
	}
}

func TestRunQuarantinesOnMalformedListPage(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	src := fakeSource{name: "src", domain: "src.test"}
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1): []byte("<html><body>Cloudflare error page</body></html>"),
	}}
	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "failed" || len(store.upserts) != 0 {
		t.Fatalf("malformed feed should fail the run: %+v", res.Summary)
	}
}

func TestRunWritesThePolicyToTheGetter(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	getter := &fakeGetter{}
	store.policy.RequestInterval = 1500 * time.Millisecond
	store.policy.MaxDecksPerRun = 900
	res, err := newRunner(store, getter).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "failed" { // no fixtures, so the run fails at the probe; the policy still had to land first
		t.Fatalf("summary %+v", res.Summary)
	}
	if getter.policy.RequestInterval != 1500*time.Millisecond || getter.policy.MaxDecksPerRun != 900 {
		t.Fatalf("policy not handed over: %+v", getter.policy)
	}
}
