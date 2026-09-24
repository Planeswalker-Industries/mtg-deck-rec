package crawl

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// Store is what a crawl needs from the database, so the run can be tested against a fake. Each instance is bound to
// one source (the app_config key, the crawl_state row and the decks it writes are all keyed by that source); the run
// never passes a source name around.
type Store interface {
	// Policy is the crawl's politeness and budget from app_config.<source>.
	Policy(ctx context.Context) (Policy, error)
	// CrawlState is the source's cursor, claim, kill switch and deck count.
	CrawlState(ctx context.Context) (CrawlState, error)
	// DeckHashes returns the content hashes we already hold for the given deck ids, so a page can be diffed without
	// reading the whole corpus. Ids we hold nothing for are absent.
	DeckHashes(ctx context.Context, ids []string) (map[string]string, error)
	// UpsertDecks writes rows; the database skips any whose content hash is unchanged.
	UpsertDecks(ctx context.Context, rows []DeckRow) error
	// CreateRun makes a crawl_runs row for the source and returns its id, so the claim can point at it.
	CreateRun(ctx context.Context) (int64, error)
	// FinishRun closes a run with what it saw and did.
	FinishRun(ctx context.Context, runID int64, summary RunSummary) error
	// Claim atomically marks the source as owned by this run, taking over a claim left behind by a crawl that died
	// without releasing it. It reports whether the claim landed: when another live run holds it, it is false and no
	// second crawl may start.
	Claim(ctx context.Context, runID int64, clientID string, staleAfter time.Duration) (Claim, error)
	// ReleaseClaim lets the next run go. It releases only a claim runID still holds.
	ReleaseClaim(ctx context.Context, runID int64) error
	// SetCursor records the newest deck the feed offered, so the state row says how far the crawl got.
	SetCursor(ctx context.Context, lastDeckID string) error
	// SetProbeOK records that the connectivity probe passed for the source.
	SetProbeOK(ctx context.Context) error
	// Disable flips the source's kill switch. Only a human re-enables it (a manual update on the row).
	Disable(ctx context.Context, reason string) error
}

// CrawlState mirrors the source's corpus.crawl_state row, plus how many decks the corpus already holds for it.
type CrawlState struct {
	LastDeckID     string
	RunningRunID   int64
	ClientID       string
	ClaimedAt      *time.Time
	Disabled       bool
	DisabledReason string
	ProbeOK        bool
	DeckCount      int
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
}

// RunSummary is written back to crawl_runs (json tags are the column names).
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
	SkippedMissing int    `json:"skipped_missing"`
	Blocks         int    `json:"blocks"`
	Error          string `json:"error,omitempty"`
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
		LastDeckID     string     `json:"lastDeckId"`
		RunningRunID   int64      `json:"runningRunId"`
		ClientID       string     `json:"clientId"`
		ClaimedAt      *time.Time `json:"claimedAt"`
		Disabled       bool       `json:"disabled"`
		DisabledReason string     `json:"disabledReason"`
		ProbeOK        bool       `json:"probeOk"`
		DeckCount      int        `json:"deckCount"`
	}
	if err := s.client.RPCInto(ctx, "crawl_state", map[string]any{"p_source": s.source}, &row); err != nil {
		return CrawlState{}, err
	}
	return CrawlState(row), nil
}

func (s *SupabaseStore) DeckHashes(ctx context.Context, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	out := map[string]string{}
	err := s.client.RPCInto(ctx, "crawl_deck_hashes",
		map[string]any{"p_source": s.source, "p_ids": ids}, &out)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *SupabaseStore) UpsertDecks(ctx context.Context, rows []DeckRow) error {
	for start := 0; start < len(rows); start += upsertBatch {
		end := min(start+upsertBatch, len(rows))
		_, err := s.client.RPC(ctx, "crawl_upsert_decks",
			map[string]any{"p_source": s.source, "p_rows": rows[start:end]})
		if err != nil {
			return err
		}
	}
	return nil
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
