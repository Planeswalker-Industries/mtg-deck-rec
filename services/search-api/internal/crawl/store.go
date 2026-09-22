package crawl

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// Store is what a crawl needs from the database, so the run can be tested against a fake. Each instance is bound to
// one source (the app_config key, the crawl_state row and the decks it writes are all keyed by that source); the run
// never passes a source name around.
type Store interface {
	// Policy is the crawl's politeness and budget from app_config.<source>.
	Policy(ctx context.Context) (Policy, error)
	// CrawlState is the source's cursor/claim/kill-switch row.
	CrawlState(ctx context.Context) (CrawlState, error)
	// ExistingDecks returns every deck we already hold for the source, keyed by source_deck_id, to diff against.
	ExistingDecks(ctx context.Context) (map[string]DeckRow, error)
	// UpsertDecks writes only rows that actually differ; callers pass exactly those.
	UpsertDecks(ctx context.Context, rows []DeckRow) error
	// CreateRun makes a crawl_runs row for the source and returns its id, so the claim can point at it.
	CreateRun(ctx context.Context) (int64, error)
	// FinishRun closes a run with what it saw and did.
	FinishRun(ctx context.Context, runID int64, summary RunSummary) error
	// Claim atomically marks the source as owned by this run. It reports whether the claim landed: when another run
	// got there first, it is false and no second crawl may start. The condition is applied by PostgREST's WHERE, so
	// two crons cannot both win.
	Claim(ctx context.Context, runID int64, clientID string) (bool, error)
	// ReleaseClaim lets the next run go.
	ReleaseClaim(ctx context.Context) error
	// SetProbeOK records that the connectivity probe passed for the source.
	SetProbeOK(ctx context.Context) error
	// Disable flips the source's kill switch. Only a human re-enables it (a manual update on the row).
	Disable(ctx context.Context, reason string) error
}

// CrawlState mirrors the source's corpus.crawl_state row.
type CrawlState struct {
	NextPage       int
	LastDeckID     string
	RunningRunID   int64
	ClientID       string
	Disabled       bool
	DisabledReason string
	ProbeOK        bool
}

// DeckRow mirrors corpus.decks.
type DeckRow struct {
	SourceDeckID    string    `json:"source_deck_id"`
	Source          string    `json:"source"`
	Commanders      []string  `json:"commanders"`
	Cards           []string  `json:"cards"`
	ContentHash     string    `json:"content_hash"`
	ListedUpdatedAt time.Time `json:"listed_updated_at"`
	LastUpdatedAt   time.Time `json:"last_updated_at"`
}

// RunSummary is written back to crawl_runs (json tags are the column names).
type RunSummary struct {
	State            string `json:"state"`
	PagesSeen        int    `json:"pages_seen"`
	DecksListed      int    `json:"decks_listed"`
	DecksFetched     int    `json:"decks_fetched"`
	DecksWritten     int    `json:"decks_written"`
	SkippedUnchanged int    `json:"skipped_unchanged"`
	Blocks           int    `json:"blocks"`
	Error            string `json:"error,omitempty"`
}

// upsertBatch keeps one write to a hundred rows: deck rows are wide (array columns), so an unbounded body would
// defeat PostgREST's own limits and the crawl's politeness.
const upsertBatch = 100

// SupabaseStore talks to the hosted database through the Supabase REST API (service role).
type SupabaseStore struct {
	client   *supabase.Client
	source   string
	defaults Defaults
	now      func() time.Time
}

func NewSupabaseStore(client *supabase.Client, source string, defaults Defaults) *SupabaseStore {
	return &SupabaseStore{client: client, source: source, defaults: defaults, now: time.Now}
}

func (s *SupabaseStore) Policy(ctx context.Context) (Policy, error) {
	raw, err := s.client.AppConfig(ctx, s.source)
	if err != nil {
		return Policy{}, err
	}
	return ParsePolicy(raw, s.defaults)
}

func (s *SupabaseStore) CrawlState(ctx context.Context) (CrawlState, error) {
	rows, err := s.client.SelectAll(ctx, "corpus.crawl_state",
		"next_page,last_deck_id,running_run_id,client_id,disabled,disabled_reason,probe_ok_at",
		"source=eq."+s.source)
	if err != nil {
		return CrawlState{}, err
	}
	if len(rows) == 0 {
		return CrawlState{}, nil
	}
	var row struct {
		NextPage       int        `json:"next_page"`
		LastDeckID     string     `json:"last_deck_id"`
		RunningRunID   int64      `json:"running_run_id"`
		ClientID       string     `json:"client_id"`
		Disabled       bool       `json:"disabled"`
		DisabledReason string     `json:"disabled_reason"`
		ProbeOKAt      *time.Time `json:"probe_ok_at"`
	}
	if err := json.Unmarshal(rows[0], &row); err != nil {
		return CrawlState{}, err
	}
	return CrawlState{
		NextPage:       row.NextPage,
		LastDeckID:     row.LastDeckID,
		RunningRunID:   row.RunningRunID,
		ClientID:       row.ClientID,
		Disabled:       row.Disabled,
		DisabledReason: row.DisabledReason,
		ProbeOK:        row.ProbeOKAt != nil,
	}, nil
}

func (s *SupabaseStore) ExistingDecks(ctx context.Context) (map[string]DeckRow, error) {
	rows, err := s.client.SelectAll(ctx, "corpus.decks",
		"source,source_deck_id,content_hash,listed_updated_at,last_updated_at", "source=eq."+s.source)
	if err != nil {
		return nil, err
	}
	out := make(map[string]DeckRow, len(rows))
	for _, raw := range rows {
		var row DeckRow
		if err := json.Unmarshal(raw, &row); err != nil {
			return nil, err
		}
		out[row.SourceDeckID] = row
	}
	return out, nil
}

func (s *SupabaseStore) UpsertDecks(ctx context.Context, rows []DeckRow) error {
	if len(rows) == 0 {
		return nil
	}
	// The row's source column is the partition; the conflict target is (source, source_deck_id), so the store sets
	// it rather than trusting the runner to remember.
	for i := range rows {
		rows[i].Source = s.source
	}
	for start := 0; start < len(rows); start += upsertBatch {
		end := min(start+upsertBatch, len(rows))
		if err := s.client.Upsert(ctx, "corpus.decks", rows[start:end], []string{"source", "source_deck_id"}); err != nil {
			return err
		}
	}
	return nil
}

func (s *SupabaseStore) CreateRun(ctx context.Context) (int64, error) {
	payload, err := s.client.Insert(ctx, "corpus.crawl_runs",
		[]map[string]any{{"source": s.source, "state": "queued"}}, "id", nil)
	if err != nil {
		return 0, err
	}
	// return=representation answers with the inserted row(s); the id is what the claim needs.
	var rows []struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(payload, &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, fmt.Errorf("creating a crawl run returned no row")
	}
	return rows[0].ID, nil
}

func (s *SupabaseStore) FinishRun(ctx context.Context, runID int64, summary RunSummary) error {
	if summary.State == "" {
		summary.State = "succeeded"
	}
	summary.State = assertState(summary.State)
	return s.client.Update(ctx, "corpus.crawl_runs", fmt.Sprintf("id=eq.%d", runID), summary)
}

func (s *SupabaseStore) Claim(ctx context.Context, runID int64, clientID string) (bool, error) {
	payload, err := s.client.UpdateReturning(
		ctx,
		"corpus.crawl_state",
		"source=eq."+s.source+" and running_run_id=is.null", // the WHERE is the mutex: only an idle source can be claimed
		"source",
		map[string]any{"running_run_id": runID, "client_id": clientID},
	)
	if err != nil {
		return false, err
	}
	// return=representation answers [] when the WHERE matched nothing, meaning someone else already claimed.
	trimmed := strings.TrimSpace(string(payload))
	return trimmed != "" && trimmed != "[]", nil
}

func (s *SupabaseStore) ReleaseClaim(ctx context.Context) error {
	return s.client.Update(ctx, "corpus.crawl_state", "source=eq."+s.source,
		map[string]any{"running_run_id": nil, "client_id": nil})
}

func (s *SupabaseStore) SetProbeOK(ctx context.Context) error {
	return s.client.Update(ctx, "corpus.crawl_state", "source=eq."+s.source,
		map[string]any{"probe_ok_at": s.now().UTC().Format(time.RFC3339Nano)})
}

func (s *SupabaseStore) Disable(ctx context.Context, reason string) error {
	return s.client.Update(ctx, "corpus.crawl_state", "source=eq."+s.source, map[string]any{
		"disabled":        true,
		"disabled_reason": reason,
		"disabled_at":     s.now().UTC().Format(time.RFC3339Nano),
	})
}

func assertState(state string) string {
	switch state {
	case "queued", "running", "succeeded", "failed":
		return state
	default:
		return "failed"
	}
}
