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
// body is JSON with commanders, cards and updatedAt. An id starting with "bad-" is a deck that does not qualify.
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
		return nil, nil // an exhausted feed, not a broken one
	}
	entries := make([]Entry, len(ids))
	for i, id := range ids {
		entries[i] = Entry{ID: id}
	}
	return entries, nil
}

func (s fakeSource) ParseDeck(body []byte, id string) (Deck, error) {
	if strings.HasPrefix(id, "bad-") {
		return Deck{}, &NotQualified{ID: id, Reason: "not a 100-card deck"}
	}
	var d struct {
		Commanders []string       `json:"commanders"`
		Cards      map[string]int `json:"cards"`
		UpdatedAt  time.Time      `json:"updatedAt"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return Deck{}, err
	}
	size := len(d.Commanders)
	for _, n := range d.Cards {
		size += n
	}
	return Deck{ID: id, Commanders: d.Commanders, Cards: d.Cards, Size: size, UpdatedAt: d.UpdatedAt}, nil
}

func deckBody(updated string, commanders []string, cards map[string]int) []byte {
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
	hashes         map[string]string
	hashCalls      [][]string
	upserts        []DeckRow
	runID          int64
	created        int
	finished       []RunSummary
	finishCtxErr   error
	claimed        int64 // the run holding the claim, 0 when free
	claimStale     bool  // the store reports the previous claim as stale and hands it over
	claimLoses     bool
	probeOK        bool
	cursor         string
	disabledReason string
}

func (s *fakeStore) Policy(context.Context) (Policy, error)         { return s.policy, nil }
func (s *fakeStore) CrawlState(context.Context) (CrawlState, error) { return s.state, nil }
func (s *fakeStore) DeckHashes(_ context.Context, ids []string) (map[string]string, error) {
	s.hashCalls = append(s.hashCalls, ids)
	out := map[string]string{}
	for _, id := range ids {
		if hash, ok := s.hashes[id]; ok {
			out[id] = hash
		}
	}
	return out, nil
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
func (s *fakeStore) FinishRun(ctx context.Context, _ int64, summary RunSummary) error {
	s.finishCtxErr = ctx.Err()
	s.finished = append(s.finished, summary)
	return nil
}
func (s *fakeStore) Claim(_ context.Context, runID int64, _ string, _ time.Duration) (Claim, error) {
	if s.claimLoses {
		return Claim{Claimed: false, HeldBy: 42}, nil
	}
	tookOver := s.claimStale
	s.claimed = runID
	return Claim{Claimed: true, TookOver: tookOver, HeldBy: runID}, nil
}
func (s *fakeStore) ReleaseClaim(_ context.Context, runID int64) error {
	if s.claimed == runID {
		s.claimed = 0
	}
	return nil
}
func (s *fakeStore) SetCursor(_ context.Context, id string) error { s.cursor = id; return nil }
func (s *fakeStore) SetProbeOK(context.Context) error             { s.probeOK = true; return nil }
func (s *fakeStore) Disable(_ context.Context, reason string) error {
	s.disabledReason = reason
	return nil
}

func newRunner(store *fakeStore, getter *fakeGetter) *Runner {
	return newFakeRunner(store, getter, fakeSource{name: "src", domain: "src.test"})
}

// Two crons that fire together are settled by the store's claim: the loser crawls nothing and says so.
func TestRunLosesTheClaimIsBusy(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy(), claimLoses: true}
	res, err := newRunner(store, &fakeGetter{}).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.AlreadyBusy {
		t.Fatalf("should report busy after losing the claim: %+v", res)
	}
	if store.claimed != 0 {
		t.Fatalf("loser must not hold the claim: %d", store.claimed)
	}
	if len(store.finished) != 1 || store.finished[0].State != "failed" {
		t.Fatalf("the loser's own run row should be closed failed: %+v", store.finished)
	}
}

// A crawl whose container died leaves its claim behind. The store hands it over, and the run says so rather than
// waiting for a human to clear the row.
func TestRunTakesOverAStaleClaim(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy(), claimStale: true}
	src := fakeSource{name: "src", domain: "src.test"}
	store.policy.BackfillDecks = 1
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):     []byte("111\n"),
		src.DeckURL("111"): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, map[string]int{"aaa": 1}),
	}}
	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "succeeded" || res.Summary.DecksWritten != 1 {
		t.Fatalf("a taken-over claim still crawls: %+v", res.Summary)
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
		src.DeckURL("111"): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, map[string]int{"aaa": 1}),
		src.DeckURL("222"): deckBody("2026-09-20T01:00:00Z", []string{"com2"}, map[string]int{"bbb": 1}),
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
	if store.cursor != "111" {
		t.Fatalf("the cursor should record where the feed started: %q", store.cursor)
	}
	if store.claimed != 0 {
		t.Fatalf("claim not released: %d", store.claimed)
	}
	if len(store.finished) != 1 || store.finished[0].State != "succeeded" {
		t.Fatalf("run not finished: %+v", store.finished)
	}
	if got := store.upserts[0].ContentHash; got != contentHash([]string{"com1"}, map[string]int{"aaa": 1}) {
		t.Fatalf("hash: %s", got)
	}
	if store.upserts[0].DeckSize != 2 {
		t.Fatalf("deck size should be carried: %d", store.upserts[0].DeckSize)
	}
}

// The hashes are read for the ids one page listed, not for the whole corpus: the corpus is the thing that grows.
func TestRunReadsHashesPerPage(t *testing.T) {
	store := &fakeStore{
		policy: Defaults{}.Policy(),
		state:  CrawlState{DeckCount: 5_000},
		hashes: map[string]string{"111": contentHash([]string{"com1"}, map[string]int{"aaa": 1})},
	}
	store.policy.MaxDecksPerRun = 2
	src := fakeSource{name: "src", domain: "src.test"}
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):     []byte("111\n222\n"),
		src.DeckURL("111"): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, map[string]int{"aaa": 1}),
		src.DeckURL("222"): deckBody("2026-09-21T00:00:00Z", []string{"com2"}, map[string]int{"bbb": 1}),
	}}

	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(store.hashCalls) != 1 || len(store.hashCalls[0]) != 2 {
		t.Fatalf("one lookup for the page's two ids: %v", store.hashCalls)
	}
	if res.Summary.SkippedUnchanged != 1 {
		t.Fatalf("skipped: %+v", res.Summary)
	}
	if len(store.upserts) != 1 || store.upserts[0].SourceDeckID != "222" {
		t.Fatalf("only the changed deck should be written: %+v", store.upserts)
	}
}

// A deck the feed listed that is not a deck the corpus wants is counted and stepped over, not a failed run.
func TestRunSkipsDecksThatDoNotQualify(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	store.policy.BackfillDecks = 2
	src := fakeSource{name: "src", domain: "src.test"}
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):         []byte("bad-111\n222\n"),
		src.DeckURL("bad-111"): []byte("{}"),
		src.DeckURL("222"):     deckBody("2026-09-21T00:00:00Z", []string{"com2"}, map[string]int{"bbb": 1}),
	}}
	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "succeeded" {
		t.Fatalf("an unqualified deck is not a failed run: %+v", res.Summary)
	}
	if res.Summary.SkippedUnqualified != 1 || res.Summary.DecksWritten != 1 {
		t.Fatalf("summary: %+v", res.Summary)
	}
}

// An exhausted feed ends the walk. Without this the page loop runs to the budget, which for a backfill is ten
// thousand requests at a source that has already said it has nothing more.
func TestRunStopsAtAnEmptyFeedPage(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	store.policy.BackfillDecks = 500
	src := fakeSource{name: "src", domain: "src.test"}
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(1):     []byte("111\n"),
		src.DeckURL("111"): deckBody("2026-09-20T00:00:00Z", []string{"com1"}, map[string]int{"aaa": 1}),
		src.ListURL(2):     []byte(""),
	}}
	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.State != "succeeded" || res.Summary.PagesSeen != 2 {
		t.Fatalf("the walk should end on the empty page: %+v", res.Summary)
	}
	if getter.requests[src.ListURL(3)] != 0 {
		t.Fatal("nothing should be asked for past the end of the feed")
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
	// The fake source reads any non-empty body as ids, so the failure lands on the deck fetch; either way the run
	// fails rather than writing something it did not understand.
	if res.Summary.State != "failed" || len(store.upserts) != 0 {
		t.Fatalf("malformed feed should fail the run: %+v", res.Summary)
	}
}

// The writes that close a run have to survive the cancellation that ended it: a run left "running" with its claim
// held is a source wedged until the stale window expires.
func TestRunFinishesEvenWhenItsContextIsCancelled(t *testing.T) {
	store := &fakeStore{policy: Defaults{}.Policy()}
	src := fakeSource{name: "src", domain: "src.test"}
	getter := &fakeGetter{pages: map[string][]byte{src.ListURL(1): []byte("111\n")}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	res, err := newFakeRunner(store, getter, src).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary.Error != "cancelled" {
		t.Fatalf("summary: %+v", res.Summary)
	}
	if len(store.finished) != 1 {
		t.Fatalf("a cancelled run still records itself: %+v", store.finished)
	}
	if store.finishCtxErr != nil {
		t.Fatalf("the closing writes must not run on the cancelled context: %v", store.finishCtxErr)
	}
	if store.claimed != 0 {
		t.Fatalf("a cancelled run still releases its claim: %d", store.claimed)
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

// The hash describes the deck, not the order the source listed it in. An order-sensitive hash rewrites every row
// whenever a site reshuffles its card list.
func TestContentHashIgnoresOrderAndCountsQuantities(t *testing.T) {
	base := contentHash([]string{"a", "b"}, map[string]int{"x": 1, "y": 2})
	if got := contentHash([]string{"b", "a"}, map[string]int{"y": 2, "x": 1}); got != base {
		t.Fatal("the same deck listed in another order is the same deck")
	}
	if got := contentHash([]string{"a", "b"}, map[string]int{"x": 1, "y": 3}); got == base {
		t.Fatal("a different number of copies is a different deck")
	}
}
