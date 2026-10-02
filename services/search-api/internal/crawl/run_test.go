package crawl

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newFakeRunner(store Store, getter Getter, src Source) *Runner {
	return NewRunner(src, getter, store, slog.New(slog.NewTextHandler(io.Discard, nil)), "test-client")
}

// fakeSource's wire format is trivial so the run loop is what is tested. A list body is one deck per line, either
// "id" or "id@<RFC 3339 listed update time>", and a line "+more" says another page follows. A deck body is JSON with
// commanders, cards and updatedAt. An id starting with "bad-" is a deck that does not qualify.
type fakeSource struct {
	name   string
	domain string
}

const moreMarker = "+more"

func (s fakeSource) Name() string { return s.name }
func (s fakeSource) ListURL(commanderName string, page int) string {
	return "https://" + s.domain + "/list?commander=" + url.QueryEscape(commanderName) + "&page=" + strconv.Itoa(page)
}
func (s fakeSource) DeckURL(id string) string { return "https://" + s.domain + "/deck/" + id }

func (s fakeSource) ParseList(body []byte) (ListPage, error) {
	var page ListPage
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
			continue
		case line == moreMarker:
			page.HasNext = true
			continue
		case strings.HasPrefix(line, "<"):
			return ListPage{}, &ShapeError{What: "deck list", Detail: "not a list"}
		}
		id, listed, _ := strings.Cut(line, "@")
		entry := Entry{ID: id}
		if listed != "" {
			t, err := time.Parse(time.RFC3339, listed)
			if err != nil {
				return ListPage{}, err
			}
			entry.UpdatedAt = t
		}
		page.Entries = append(page.Entries, entry)
	}
	return page, nil
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

// ledBy is a deck body led by one commander, with one card that makes it distinct.
func ledBy(commanderOracleID, card string) []byte {
	return deckBody("2026-09-20T00:00:00Z", []string{commanderOracleID}, map[string]int{card: 1})
}

// fakeGetter answers known URLs from a fixture map, or stands in for a wall.
type fakeGetter struct {
	pages    map[string][]byte
	blockAll bool
	policy   Policy
	requests map[string]int
	// URLs that answer an HTTP status instead of a body, so a test can stage a deck that has gone since it was
	// listed - the ordinary consequence of crawling at the polite pace.
	statuses map[string]int
}

func (g *fakeGetter) Get(_ context.Context, rawurl string) ([]byte, error) {
	if g.requests == nil {
		g.requests = map[string]int{}
	}
	g.requests[rawurl]++
	if g.blockAll {
		return nil, &Blocked{URL: rawurl}
	}
	if status, ok := g.statuses[rawurl]; ok {
		return nil, &HTTPError{Status: status, URL: rawurl}
	}
	if body, ok := g.pages[rawurl]; ok {
		return body, nil
	}
	return nil, fmt.Errorf("no fixture for %s", rawurl)
}

func (g *fakeGetter) SetPolicy(p Policy) { g.policy = p }

// fakeStore stands in for the database, including the two behaviours the run depends on: the queue leaves out
// commanders this run already finished, and an upsert records the listed update time.
type fakeStore struct {
	policy         Policy
	state          CrawlState
	commanders     []Commander
	finishedBy     map[int]int64 // commander card id -> the run that last finished it
	visits         map[int]CommanderResult
	visitOrder     []int
	seeded         int
	held           map[string]HeldDeck
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

func newStore(commanders ...Commander) *fakeStore {
	return &fakeStore{policy: Defaults{}.Policy(), commanders: commanders}
}

func (s *fakeStore) Policy(context.Context) (Policy, error)         { return s.policy, nil }
func (s *fakeStore) CrawlState(context.Context) (CrawlState, error) { return s.state, nil }
func (s *fakeStore) SeedCommanders(context.Context) (int, error)    { s.seeded++; return 0, nil }
func (s *fakeStore) NextCommanders(_ context.Context, runID int64, limit int) ([]Commander, error) {
	var out []Commander
	for _, c := range s.commanders {
		if s.finishedBy[c.CardID] == runID || s.visits[c.CardID].Outcome == OutcomeNotFound {
			continue
		}
		if len(out) == limit {
			break
		}
		out = append(out, c)
	}
	return out, nil
}
func (s *fakeStore) FinishCommander(_ context.Context, runID int64, cardID int, result CommanderResult) error {
	if s.finishedBy == nil {
		s.finishedBy, s.visits = map[int]int64{}, map[int]CommanderResult{}
	}
	s.finishedBy[cardID] = runID
	s.visits[cardID] = result
	s.visitOrder = append(s.visitOrder, cardID)
	return nil
}
func (s *fakeStore) DeckVersions(_ context.Context, ids []string) (map[string]HeldDeck, error) {
	out := map[string]HeldDeck{}
	for _, id := range ids {
		if held, ok := s.held[id]; ok {
			out[id] = held
		}
	}
	return out, nil
}
func (s *fakeStore) UpsertDecks(_ context.Context, rows []DeckRow) error {
	if s.held == nil {
		s.held = map[string]HeldDeck{}
	}
	for _, row := range rows {
		s.held[row.SourceDeckID] = HeldDeck{Hash: row.ContentHash, ListedUpdatedAt: row.ListedUpdatedAt}
	}
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

var src = fakeSource{name: "src", domain: "src.test"}

// liesa is a commander on her first visit; the tests' decks led by her carry her oracle id.
var liesa = Commander{CardID: 1, OracleID: "oc-liesa", Name: "Liesa, Forgotten Archangel"}

func revisit(c Commander) Commander {
	c.Visited = true
	c.QueryName = c.Name
	return c
}

func run(t *testing.T, store *fakeStore, getter *fakeGetter) Result {
	t.Helper()
	res, err := newFakeRunner(store, getter, src).Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// Two crons that fire together are settled by the store's claim: the loser crawls nothing and says so.
func TestRunLosesTheClaimIsBusy(t *testing.T) {
	store := newStore(liesa)
	store.claimLoses = true
	res := run(t, store, &fakeGetter{})
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
	store := newStore(liesa)
	store.claimStale = true
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
	}}
	res := run(t, store, getter)
	if res.Summary.State != "succeeded" || res.Summary.DecksWritten != 1 {
		t.Fatalf("a taken-over claim still crawls: %+v", res.Summary)
	}
}

func TestRunDisabledIsANoop(t *testing.T) {
	store := newStore(liesa)
	store.state = CrawlState{Disabled: true, DisabledReason: "Cloudflare"}
	res := run(t, store, &fakeGetter{})
	if store.created != 0 || res.Summary.State != "failed" {
		t.Fatalf("disabled run should create nothing: %+v, created=%d", res, store.created)
	}
}

// The first visit reads page 1 only and writes what it found, and the run records the visit, the probe and where it
// started. The queue is seeded first so a new EDHREC import reaches it.
func TestFirstVisitReadsTheFirstPageOnly(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n222\n" + moreMarker + "\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
		src.DeckURL("222"):         ledBy(liesa.OracleID, "bbb"),
	}}
	res := run(t, store, getter)
	if res.Summary.State != "succeeded" || res.Summary.DecksWritten != 2 || res.Summary.CommandersVisited != 1 {
		t.Fatalf("summary: %+v", res.Summary)
	}
	if getter.requests[src.ListURL(liesa.Name, 2)] != 0 {
		t.Fatal("a first visit must not read past page 1")
	}
	visit := store.visits[liesa.CardID]
	if visit.Outcome != OutcomeDone || visit.Counted != 2 || visit.QueryName != liesa.Name {
		t.Fatalf("visit: %+v", visit)
	}
	if store.seeded != 1 || !store.probeOK || store.cursor != "111" || store.claimed != 0 {
		t.Fatalf("seeded=%d probe=%v cursor=%q claimed=%d", store.seeded, store.probeOK, store.cursor, store.claimed)
	}
	if got := store.upserts[0].ContentHash; got != contentHash([]string{liesa.OracleID}, map[string]int{"aaa": 1}) {
		t.Fatalf("hash: %s", got)
	}
	if store.upserts[0].DeckSize != 2 {
		t.Fatalf("deck size should be carried: %d", store.upserts[0].DeckSize)
	}
}

// One run works down the queue, one commander after another, until the queue is empty.
func TestRunVisitsCommandersInQueueOrder(t *testing.T) {
	edgar := Commander{CardID: 2, OracleID: "oc-edgar", Name: "Edgar Markov"}
	store := newStore(liesa, edgar)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
		src.ListURL(edgar.Name, 1): []byte("222\n"),
		src.DeckURL("222"):         ledBy(edgar.OracleID, "bbb"),
	}}
	res := run(t, store, getter)
	if res.Summary.CommandersVisited != 2 || fmt.Sprint(store.visitOrder) != "[1 2]" {
		t.Fatalf("visited %v: %+v", store.visitOrder, res.Summary)
	}
}

// The commander search also finds decks that merely run the card. Such a deck is kept - it is a real deck, already
// fetched - but it does not count toward this commander, and a first visit that finds only those is logged.
func TestDecksLedByAnotherCommanderAreKeptNotCounted(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n"),
		src.DeckURL("111"):         ledBy("oc-someone-else", "aaa"),
	}}
	res := run(t, store, getter)
	visit := store.visits[liesa.CardID]
	if res.Summary.DecksWritten != 1 || visit.Counted != 0 || visit.WrongCommander != 1 {
		t.Fatalf("summary %+v, visit %+v", res.Summary, visit)
	}
	if visit.Outcome != OutcomeNoLedDecks {
		t.Fatalf("a first visit with no decks it leads belongs in the verification log: %+v", visit)
	}
}

// A two-faced commander is tried under its front face when the full name finds nothing, and the name that worked is
// recorded for next time.
func TestNotFoundTriesTheFrontFace(t *testing.T) {
	esika := Commander{CardID: 3, OracleID: "oc-esika", Name: "Esika, Queen of the Hold // The Prismatic Bridge"}
	store := newStore(esika)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(esika.Name, 1):                 []byte(""),
		src.ListURL("Esika, Queen of the Hold", 1): []byte("111\n"),
		src.DeckURL("111"):                         ledBy(esika.OracleID, "aaa"),
	}}
	run(t, store, getter)
	visit := store.visits[esika.CardID]
	if visit.Outcome != OutcomeDone || visit.QueryName != "Esika, Queen of the Hold" || visit.Counted != 1 {
		t.Fatalf("visit: %+v", visit)
	}
}

// A commander the source has nothing for is recorded as not found - the verification log - and the run moves on.
func TestNotFoundIsLoggedAndTheRunMovesOn(t *testing.T) {
	ghost := Commander{CardID: 4, OracleID: "oc-ghost", Name: "Nobody Plays Me"}
	store := newStore(ghost, liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(ghost.Name, 1): []byte(""),
		src.ListURL(liesa.Name, 1): []byte("111\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
	}}
	res := run(t, store, getter)
	if store.visits[ghost.CardID].Outcome != OutcomeNotFound {
		t.Fatalf("ghost: %+v", store.visits[ghost.CardID])
	}
	if res.Summary.State != "succeeded" || store.visits[liesa.CardID].Counted != 1 {
		t.Fatalf("the run should carry on past a commander with no decks: %+v", res.Summary)
	}
}

// A revisit walks on until it has found its target of new decks led by the commander, and stops there.
func TestRevisitStopsAtItsTarget(t *testing.T) {
	store := newStore(revisit(liesa))
	store.policy.NewDecksPerRevisit = 2
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n" + moreMarker + "\n"),
		src.ListURL(liesa.Name, 2): []byte("222\n333\n" + moreMarker + "\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
		src.DeckURL("222"):         ledBy(liesa.OracleID, "bbb"),
	}}
	run(t, store, getter)
	visit := store.visits[liesa.CardID]
	if visit.Outcome != OutcomeDone || visit.Counted != 2 {
		t.Fatalf("visit: %+v", visit)
	}
	if getter.requests[src.DeckURL("333")] != 0 {
		t.Fatal("nothing should be fetched once the target is met")
	}
}

// A held deck whose listed update time has not moved is stepped over without a request. One whose time moved is
// fetched; if its cards are the same it does not count, but its new listed time is recorded so it is not fetched
// again next visit.
func TestRevisitStepsOverHeldDecks(t *testing.T) {
	store := newStore(revisit(liesa))
	sept1 := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	store.held = map[string]HeldDeck{
		"111": {Hash: contentHash([]string{liesa.OracleID}, map[string]int{"aaa": 1}), ListedUpdatedAt: sept1},
		"222": {Hash: contentHash([]string{liesa.OracleID}, map[string]int{"bbb": 1}), ListedUpdatedAt: sept1},
	}
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111@2026-09-10T00:00:00Z\n222@2026-09-01T00:00:00Z\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
	}}
	res := run(t, store, getter)
	if getter.requests[src.DeckURL("222")] != 0 {
		t.Fatal("a held deck whose listed time has not moved must not be fetched")
	}
	if res.Summary.DecksWritten != 0 || res.Summary.SkippedUnchanged != 2 || store.visits[liesa.CardID].Counted != 0 {
		t.Fatalf("an edit that left the cards alone is not a new deck: %+v", res.Summary)
	}
	if got := store.held["111"].ListedUpdatedAt; !got.Equal(time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("the new listed time should be recorded: %v", got)
	}
	if store.visits[liesa.CardID].Outcome != OutcomeExhausted {
		t.Fatalf("a revisit that ran out of list is exhausted: %+v", store.visits[liesa.CardID])
	}
}

// A revisit of a huge commander stops at the page cap rather than taking the run.
func TestRevisitStopsAtThePageCap(t *testing.T) {
	store := newStore(revisit(liesa))
	store.policy.MaxPagesPerCommander = 1
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n" + moreMarker + "\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
	}}
	run(t, store, getter)
	if got := store.visits[liesa.CardID].Outcome; got != OutcomePageCap || getter.requests[src.ListURL(liesa.Name, 2)] != 0 {
		t.Fatalf("outcome %s", got)
	}
}

// The run stops when its time is up. The commander it was on is left partial, which brings it back first next run.
func TestRunOutOfTimeLeavesTheCommanderPartial(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("111\n222\n"),
		src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
		src.DeckURL("222"):         ledBy(liesa.OracleID, "bbb"),
	}}
	runner := newFakeRunner(store, getter, src)
	// Readings: the deadline, the commander check, then one before each fetch. The clock jumps past the run's
	// length after the first fetch.
	start, readings := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), 0
	runner.now = func() time.Time {
		readings++
		if readings > 3 {
			return start.Add(store.policy.RunDuration)
		}
		return start
	}
	res, err := runner.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	visit := store.visits[liesa.CardID]
	if visit.Outcome != OutcomePartial || visit.Counted != 1 || getter.requests[src.DeckURL("222")] != 0 {
		t.Fatalf("visit %+v", visit)
	}
	if res.Summary.State != "succeeded" {
		t.Fatalf("running out of time is how a run ends, not a failure: %+v", res.Summary)
	}
}

// An empty queue is a finished crawl, not a failed one.
func TestRunWithAnEmptyQueueSucceeds(t *testing.T) {
	res := run(t, newStore(), &fakeGetter{})
	if res.Summary.State != "succeeded" || res.Summary.CommandersVisited != 0 {
		t.Fatalf("summary: %+v", res.Summary)
	}
}

// A deck the list showed that is not a deck the corpus wants is counted and stepped over, not a failed run.
func TestRunSkipsDecksThatDoNotQualify(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("bad-111\n222\n"),
		src.DeckURL("bad-111"):     []byte("{}"),
		src.DeckURL("222"):         ledBy(liesa.OracleID, "bbb"),
	}}
	res := run(t, store, getter)
	if res.Summary.State != "succeeded" {
		t.Fatalf("an unqualified deck is not a failed run: %+v", res.Summary)
	}
	if res.Summary.SkippedUnqualified != 1 || res.Summary.DecksWritten != 1 {
		t.Fatalf("summary: %+v", res.Summary)
	}
}

func TestProbeBlockDisablesTheSource(t *testing.T) {
	store := newStore(liesa)
	res := run(t, store, &fakeGetter{blockAll: true})
	if store.disabledReason == "" || res.Summary.State != "failed" {
		t.Fatalf("should have disabled: reason=%q summary=%+v", store.disabledReason, res.Summary)
	}
	if store.visits[liesa.CardID].Outcome != OutcomeFailed {
		t.Fatalf("the commander being visited records the failure: %+v", store.visits[liesa.CardID])
	}
}

func TestRunQuarantinesOnMalformedListPage(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{
		src.ListURL(liesa.Name, 1): []byte("<html><body>Cloudflare error page</body></html>"),
	}}
	res := run(t, store, getter)
	if res.Summary.State != "failed" || len(store.upserts) != 0 {
		t.Fatalf("a malformed list should fail the run: %+v", res.Summary)
	}
	if visit := store.visits[liesa.CardID]; visit.Outcome != OutcomeFailed || visit.Error == "" {
		t.Fatalf("visit: %+v", visit)
	}
}

// The writes that close a run have to survive the cancellation that ended it: a run left "running" with its claim
// held is a source wedged until the stale window expires.
func TestRunFinishesEvenWhenItsContextIsCancelled(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{pages: map[string][]byte{src.ListURL(liesa.Name, 1): []byte("111\n")}}
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
	store := newStore(liesa)
	getter := &fakeGetter{}
	store.policy.RequestInterval = 1500 * time.Millisecond
	store.policy.NewDecksPerRevisit = 90
	res := run(t, store, getter)
	if res.Summary.State != "failed" { // no fixtures, so the run fails at the first list; the policy still had to land first
		t.Fatalf("summary %+v", res.Summary)
	}
	if getter.policy.RequestInterval != 1500*time.Millisecond || getter.policy.NewDecksPerRevisit != 90 {
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

// A deck that has gone since it was listed. The loop runs at the polite pace, so minutes pass between listing and
// fetching; deletions in that window are ordinary. One of them once ended the whole run - and every run after it,
// since the next run listed the same deck.
func TestRunSkipsDecksThatHaveGone(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{
		pages: map[string][]byte{
			src.ListURL(liesa.Name, 1): []byte("111\n222\n333\n"),
			src.DeckURL("111"):         ledBy(liesa.OracleID, "aaa"),
			src.DeckURL("333"):         ledBy(liesa.OracleID, "ccc"),
		},
		statuses: map[string]int{src.DeckURL("222"): http.StatusNotFound},
	}
	res := run(t, store, getter)
	if res.Summary.State != "succeeded" {
		t.Fatalf("a deck that is gone is not a failed run: %+v", res.Summary)
	}
	if res.Summary.SkippedMissing != 1 {
		t.Fatalf("the missing deck should be counted: %+v", res.Summary)
	}
	// The decks either side of it are still crawled: the run steps over the gap rather than stopping at it.
	if res.Summary.DecksWritten != 2 {
		t.Fatalf("the run should have continued past the gap: %+v", res.Summary)
	}
	// Counted apart, so nobody reads "the list filters are wrong" from a deck that simply no longer exists.
	if res.Summary.SkippedUnqualified != 0 {
		t.Fatalf("a missing deck is not an unqualified one: %+v", res.Summary)
	}
}

// 410 means the same thing as 404 here and is treated the same.
func TestRunSkipsDecksThatAreGone410(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{
		pages: map[string][]byte{
			src.ListURL(liesa.Name, 1): []byte("111\n222\n"),
			src.DeckURL("222"):         ledBy(liesa.OracleID, "bbb"),
		},
		statuses: map[string]int{src.DeckURL("111"): http.StatusGone},
	}
	res := run(t, store, getter)
	if res.Summary.State != "succeeded" || res.Summary.SkippedMissing != 1 || res.Summary.DecksWritten != 1 {
		t.Fatalf("summary: %+v", res.Summary)
	}
}

// The ceiling. Skipping missing decks without one would trade a loud failure for a silent nightly no-op: if the deck
// endpoint moved, every deck would be "gone" and the run would report success over an empty corpus.
func TestRunFailsWhenTheWholeListIsMissing(t *testing.T) {
	store := newStore(liesa)
	var ids []string
	statuses := map[string]int{}
	for i := range 60 {
		id := fmt.Sprintf("%d", 1000+i)
		ids = append(ids, id)
		statuses[src.DeckURL(id)] = http.StatusNotFound
	}
	getter := &fakeGetter{
		pages:    map[string][]byte{src.ListURL(liesa.Name, 1): []byte(strings.Join(ids, "\n") + "\n")},
		statuses: statuses,
	}
	res := run(t, store, getter)
	if res.Summary.State != "failed" {
		t.Fatalf("a list where nothing resolves is a broken adapter, not a quiet success: %+v", res.Summary)
	}
	if !strings.Contains(res.Summary.Error, "missing") {
		t.Fatalf("the run should say why it stopped: %q", res.Summary.Error)
	}
	// It stops as soon as it is sure, rather than walking the whole list proving it.
	if res.Summary.SkippedMissing > missingDeckFloor+1 {
		t.Fatalf("stopped too late, after %d misses", res.Summary.SkippedMissing)
	}
}

// A few missing decks in a short run must not trip the ceiling: that is bad luck, not a broken list.
func TestRunToleratesMissingDecksBelowTheFloor(t *testing.T) {
	store := newStore(liesa)
	getter := &fakeGetter{
		pages: map[string][]byte{
			src.ListURL(liesa.Name, 1): []byte("111\n222\n333\n"),
			src.DeckURL("333"):         ledBy(liesa.OracleID, "ccc"),
		},
		statuses: map[string]int{
			src.DeckURL("111"): http.StatusNotFound,
			src.DeckURL("222"): http.StatusNotFound,
		},
	}
	res := run(t, store, getter)
	// Two of three missing is past the share but nowhere near the floor, so the run carries on and succeeds.
	if res.Summary.State != "succeeded" || res.Summary.SkippedMissing != 2 || res.Summary.DecksWritten != 1 {
		t.Fatalf("summary: %+v", res.Summary)
	}
}
