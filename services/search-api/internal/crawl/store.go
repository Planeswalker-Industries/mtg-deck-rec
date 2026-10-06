package crawl

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// Store is what a crawl needs from the database, so the run can be tested against a fake. Each instance is bound to
// one source (the app_config key, the crawl.state row and the raw deck table it writes are all keyed by that source);
// the run never passes a source name around.
type Store interface {
	// Policy is the crawl's politeness and budget from app_config.<source>.
	Policy(ctx context.Context) (Policy, error)
	// CrawlState is the source's cursor, claim, kill switch, deck count and queue progress.
	CrawlState(ctx context.Context) (CrawlState, error)
	// SeedCommanders adds the commanders the seed list (EDHREC) knows to the queue and refreshes their order; it
	// writes only what changed and returns how many rows that was.
	SeedCommanders(ctx context.Context) (int, error)
	// NextCommanders returns up to limit commanders to visit, in queue order, leaving out those this run already
	// tried and those the source has no decks for.
	NextCommanders(ctx context.Context, runID int64, limit int) ([]Commander, error)
	// FinishCommander records one commander's visit.
	FinishCommander(ctx context.Context, runID int64, cardID int, result CommanderResult) error
	// DeckVersions returns what we already hold for the given deck ids, so a page can be diffed without reading the
	// whole corpus. Ids we hold nothing for are absent.
	DeckVersions(ctx context.Context, ids []string) (map[string]HeldDeck, error)
	// UpsertDecks writes rows; the database skips any whose content hash and listed update time are both unchanged.
	// It stores decks raw, in the source's own schema, as the source sent them; only a deck with an id that is not an
	// oracle id at all is refused, and comes back as unresolved.
	UpsertDecks(ctx context.Context, rows []DeckRow) ([]UnresolvedDeck, error)
	// CreateRun makes a crawl.runs row for the source and returns its id, so the claim can point at it.
	CreateRun(ctx context.Context) (int64, error)
	// FinishRun closes a run with what it saw and did.
	FinishRun(ctx context.Context, runID int64, summary RunSummary) error
	// Claim atomically marks the source as owned by this run, taking over a claim left behind by a crawl that died
	// without releasing it. It reports whether the claim landed: when another live run holds it, it is false and no
	// second crawl may start.
	Claim(ctx context.Context, runID int64, clientID string, staleAfter time.Duration) (Claim, error)
	// ReleaseClaim lets the next run go. It releases only a claim runID still holds.
	ReleaseClaim(ctx context.Context, runID int64) error
	// SetCursor records the first deck a run listed, so the state row says where the crawl was last seen working.
	SetCursor(ctx context.Context, lastDeckID string) error
	// SetProbeOK records that the connectivity probe passed for the source.
	SetProbeOK(ctx context.Context) error
	// Disable flips the source's kill switch. Only a human re-enables it (a manual update on the row).
	Disable(ctx context.Context, reason string) error
}

// CrawlState mirrors the source's crawl.state row, plus how many decks its raw table holds.
type CrawlState struct {
	LastDeckID     string
	RunningRunID   int64
	ClientID       string
	ClaimedAt      *time.Time
	Disabled       bool
	DisabledReason string
	ProbeOK        bool
	DeckCount      int
	// Queue progress: never visited yet, visited at least once, and the verification log (no decks under that name,
	// or none led by that commander).
	CommandersQueued   int
	CommandersVisited  int
	CommandersNotFound int
}

// Commander is one entry of the crawl queue.
type Commander struct {
	CardID   int    `json:"cardId"`
	OracleID string `json:"oracleId"`
	Name     string `json:"name"`
	// HeldDecks is how many decks the corpus already holds that this commander leads. The queue orders by it, so a
	// commander with three decks is served before one with five hundred; it is read here only for the log.
	HeldDecks int `json:"heldDecks"`
	// QueryName is the name that found decks on an earlier visit (the front face of a two-faced card, say); empty
	// until a visit found listings.
	QueryName string `json:"queryName"`
	// Visited is false until the commander's first complete visit, which reads only Policy.FirstVisitPages.
	Visited bool `json:"visited"`
}

// Commander visit outcomes, as crawl.queue.outcome stores them.
const (
	OutcomeDone       = "done"         // the visit did what it set out to: its first page, or its revisit target
	OutcomeExhausted  = "exhausted"    // the commander's list ran out before the revisit target
	OutcomePageCap    = "page_cap"     // a revisit hit Policy.MaxPagesPerCommander
	OutcomePartial    = "partial"      // the run's time ran out mid-visit; the commander comes back first
	OutcomeNotFound   = "not_found"    // no listings under its name or front face: the verification log
	OutcomeNoLedDecks = "no_led_decks" // a first visit found listings, but none were decks it leads
	OutcomeFailed     = "failed"       // the visit hit an error that ended the run
	OutcomeFetchCap   = "fetch_cap"    // the visit stopped at Policy.MaxFetchesPerCommander
)

// CommanderResult is what one visit did, written back to crawl.queue.
type CommanderResult struct {
	Outcome        string `json:"outcome"`
	Error          string `json:"error,omitempty"`
	QueryName      string `json:"queryName,omitempty"`
	Listed         int    `json:"listed"`
	Fetched        int    `json:"fetched"`
	Written        int    `json:"written"`
	Counted        int    `json:"counted"`
	WrongCommander int    `json:"wrongCommander"`
}

// HeldDeck is what the corpus already holds for a deck: its content hash, and the update time the list showed when
// it was last written.
type HeldDeck struct {
	Hash            string    `json:"hash"`
	ListedUpdatedAt time.Time `json:"listedUpdatedAt"`
}

// Claim is the outcome of trying to take a source's single-flight lock.
type Claim struct {
	Claimed bool
	// TookOver reports that the previous holder's claim had gone stale and was seized. Worth logging: it means a
	// crawl died without releasing, which is normally a deploy landing mid-run.
	TookOver bool
	HeldBy   int64
}

// DeckRow is one scraped deck as it is written. Cards carry their quantities: a deck's basics are most of what
// distinguishes its mana base, and the deck's size cannot be recovered from a set of distinct cards.
type DeckRow struct {
	SourceDeckID    string         `json:"source_deck_id"`
	Commanders      []string       `json:"commanders"`
	Cards           map[string]int `json:"cards"`
	DeckSize        int            `json:"deck_size"`
	ContentHash     string         `json:"content_hash"`
	ListedUpdatedAt time.Time      `json:"listed_updated_at"`
	LastUpdatedAt   time.Time      `json:"last_updated_at"`
	// The author's bracket, absent when they gave none. Not in the content hash: a deck whose author only re-rated it
	// moves its listed time, which is what brings it back.
	DeclaredBracket *int `json:"declared_bracket,omitempty"`
}

// UnresolvedDeck is a deck the database would not store because an id in it is not an oracle id at all. (A card the
// catalog merely lacks is stored raw.) Nothing is held for it, so the next visit fetches it again.
type UnresolvedDeck struct {
	DeckID string `json:"deckId"`
	// The ids that are not oracle ids, for the log.
	Missing []string `json:"missing"`
}

// RunSummary is written back to crawl.runs (json tags are the column names).
type RunSummary struct {
	State              string `json:"state"`
	PagesSeen          int    `json:"pages_seen"`
	DecksListed        int    `json:"decks_listed"`
	DecksFetched       int    `json:"decks_fetched"`
	DecksWritten       int    `json:"decks_written"`
	SkippedUnchanged   int    `json:"skipped_unchanged"`
	SkippedUnqualified int    `json:"skipped_unqualified"`
	// Decks the feed listed that were gone by the time the crawl asked for them. Apart from SkippedUnqualified
	// because the two say different things: unqualified means the browse filters admit decks the corpus does not
	// want, missing means the feed is stale or the crawl is falling behind deletions.
	SkippedMissing int `json:"skipped_missing"`
	// Decks fetched but not stored because an id in them is not an oracle id. Apart from the others because it is
	// worth a look whenever it is above zero: the source sent something its own format does not allow.
	SkippedUnresolved int `json:"skipped_unresolved"`
	CommandersVisited int `json:"commanders_visited"`
	// How many times the source answered 429, and where the crawl was the last time it did. The pace widens itself in
	// response (see Fetcher), so these are the record of a run that was slowed down - without them, a crawl that spent
	// half its time at the ceiling looks the same as one that never met resistance.
	Throttles         int    `json:"throttles"`
	ThrottledPosition string `json:"throttled_position,omitempty"`
	Blocks            int    `json:"blocks"`
	Error             string `json:"error,omitempty"`
}

// upsertBatch keeps one write to a hundred decks: deck rows are wide, so an unbounded body would defeat PostgREST's
// own limits and the crawl's politeness.
const upsertBatch = 100

// SupabaseStore talks to the hosted database through the public.crawl_* functions (service role). It never touches a
// corpus table directly: PostgREST cannot address an unexposed schema, and exposing this one would hand third-party
// decklists to the API roles.
type SupabaseStore struct {
	client   *supabase.Client
	source   string
	defaults Defaults
}

func NewSupabaseStore(client *supabase.Client, source string, defaults Defaults) *SupabaseStore {
	return &SupabaseStore{client: client, source: source, defaults: defaults}
}

func (s *SupabaseStore) Policy(ctx context.Context) (Policy, error) {
	raw, err := s.client.AppConfig(ctx, s.source)
	if err != nil {
		return Policy{}, err
	}
	return ParsePolicy(raw, s.defaults)
}

func (s *SupabaseStore) CrawlState(ctx context.Context) (CrawlState, error) {
	var row struct {
		LastDeckID         string     `json:"lastDeckId"`
		RunningRunID       int64      `json:"runningRunId"`
		ClientID           string     `json:"clientId"`
		ClaimedAt          *time.Time `json:"claimedAt"`
		Disabled           bool       `json:"disabled"`
		DisabledReason     string     `json:"disabledReason"`
		ProbeOK            bool       `json:"probeOk"`
		DeckCount          int        `json:"deckCount"`
		CommandersQueued   int        `json:"commandersQueued"`
		CommandersVisited  int        `json:"commandersVisited"`
		CommandersNotFound int        `json:"commandersNotFound"`
	}
	if err := s.client.RPCInto(ctx, "crawl_state", map[string]any{"p_source": s.source}, &row); err != nil {
		return CrawlState{}, err
	}
	return CrawlState(row), nil
}

func (s *SupabaseStore) SeedCommanders(ctx context.Context) (int, error) {
	var n int
	err := s.client.RPCInto(ctx, "crawl_seed_commanders", map[string]any{"p_source": s.source}, &n)
	return n, err
}

func (s *SupabaseStore) NextCommanders(ctx context.Context, runID int64, limit int) ([]Commander, error) {
	var out []Commander
	err := s.client.RPCInto(ctx, "crawl_next_commanders",
		map[string]any{"p_source": s.source, "p_run_id": runID, "p_limit": limit}, &out)
	return out, err
}

func (s *SupabaseStore) FinishCommander(ctx context.Context, runID int64, cardID int, result CommanderResult) error {
	payload, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.client.RPC(ctx, "crawl_finish_commander", map[string]any{
		"p_source":  s.source,
		"p_card_id": cardID,
		"p_run_id":  runID,
		"p_result":  json.RawMessage(payload),
	})
	return err
}

func (s *SupabaseStore) DeckVersions(ctx context.Context, ids []string) (map[string]HeldDeck, error) {
	if len(ids) == 0 {
		return map[string]HeldDeck{}, nil
	}
	out := map[string]HeldDeck{}
	err := s.client.RPCInto(ctx, "crawl_deck_versions",
		map[string]any{"p_source": s.source, "p_ids": ids}, &out)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *SupabaseStore) UpsertDecks(ctx context.Context, rows []DeckRow) ([]UnresolvedDeck, error) {
	var unresolved []UnresolvedDeck
	for start := 0; start < len(rows); start += upsertBatch {
		end := min(start+upsertBatch, len(rows))
		var out struct {
			Unresolved []UnresolvedDeck `json:"unresolved"`
		}
		err := s.client.RPCInto(ctx, "crawl_upsert_decks",
			map[string]any{"p_source": s.source, "p_rows": rows[start:end]}, &out)
		if err != nil {
			return nil, err
		}
		unresolved = append(unresolved, out.Unresolved...)
	}
	return unresolved, nil
}

func (s *SupabaseStore) CreateRun(ctx context.Context) (int64, error) {
	var id int64
	if err := s.client.RPCInto(ctx, "crawl_create_run", map[string]any{"p_source": s.source}, &id); err != nil {
		return 0, err
	}
	if id == 0 {
		return 0, fmt.Errorf("creating a crawl run returned no id")
	}
	return id, nil
}

func (s *SupabaseStore) FinishRun(ctx context.Context, runID int64, summary RunSummary) error {
	summary.State = assertState(summary.State)
	payload, err := json.Marshal(summary)
	if err != nil {
		return err
	}
	_, err = s.client.RPC(ctx, "crawl_finish_run",
		map[string]any{"p_run_id": runID, "p_summary": json.RawMessage(payload)})
	return err
}

func (s *SupabaseStore) Claim(ctx context.Context, runID int64, clientID string, staleAfter time.Duration) (Claim, error) {
	var out struct {
		Claimed  bool  `json:"claimed"`
		TookOver bool  `json:"tookOver"`
		HeldBy   int64 `json:"heldBy"`
	}
	err := s.client.RPCInto(ctx, "crawl_claim", map[string]any{
		"p_source":              s.source,
		"p_run_id":              runID,
		"p_client_id":           clientID,
		"p_stale_after_seconds": int(staleAfter.Seconds()),
	}, &out)
	if err != nil {
		return Claim{}, err
	}
	return Claim(out), nil
}

func (s *SupabaseStore) ReleaseClaim(ctx context.Context, runID int64) error {
	_, err := s.client.RPC(ctx, "crawl_release", map[string]any{"p_source": s.source, "p_run_id": runID})
	return err
}

func (s *SupabaseStore) SetCursor(ctx context.Context, lastDeckID string) error {
	_, err := s.client.RPC(ctx, "crawl_set_cursor",
		map[string]any{"p_source": s.source, "p_last_deck_id": lastDeckID})
	return err
}

func (s *SupabaseStore) SetProbeOK(ctx context.Context) error {
	_, err := s.client.RPC(ctx, "crawl_probe_ok", map[string]any{"p_source": s.source})
	return err
}

func (s *SupabaseStore) Disable(ctx context.Context, reason string) error {
	_, err := s.client.RPC(ctx, "crawl_disable", map[string]any{"p_source": s.source, "p_reason": reason})
	return err
}

func assertState(state string) string {
	switch state {
	case "queued", "running", "succeeded", "failed":
		return state
	default:
		return "failed"
	}
}
