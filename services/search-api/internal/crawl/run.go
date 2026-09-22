package crawl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// Source is the site-specific half of a crawl: how it lists decks by update and what its list and deck pages mean.
// Nothing downstream sees the source - the runner works only with what Source answers.
type Source interface {
	// Name is the source key: the app_config policy row, the corpus.crawl_state row and the decks' source column.
	Name() string
	// ListURL is the browse feed, newest-update-first. The runner pages it (1, 2, ...) until decks stop changing.
	ListURL(page int) string
	// DeckURL is one deck's page.
	DeckURL(id string) string
	// ParseList turns a feed page body into the deck ids it listed, in feed order.
	ParseList(body []byte) ([]Entry, error)
	// ParseDeck turns a deck page body into the deck's content. id is the entry's ID from the feed.
	ParseDeck(body []byte, id string) (Deck, error)
}

// Entry is one deck id the feed listed. Both sources' ids are stable strings (Archidekt's numeric id, Moxfield's
// slug).
type Entry struct {
	ID string
}

// Deck is one parsed deck: commander(s) and the other cards, oracle-level, plus its authoritative update time.
type Deck struct {
	ID             string
	CommanderNames []string
	Commanders     []string // oracle ids, sorted so a partner pair keys deterministically
	Cards          []string // oracle ids of the other cards, as listed
	UpdatedAt      time.Time
}

// caughtUpLimit unchanged decks in a row means the feed has passed the frontier of what the corpus already holds
// (the feed is update-ordered, newest first). Past it, every listing is an old, unchanged deck.
const caughtUpLimit = 10

// Result describes what one invocation of the crawl did: nothing at all when a crawl was already running or the
// source is disabled (both are normal states the cron should not treat as failures).
type Result struct {
	RunID       int64
	AlreadyBusy bool
	DisabledBy  string // the reason, when this run flipped the kill switch; empty otherwise
	Summary     RunSummary
}

// Status is what the status endpoint reports: the kill switch, whether a crawl is running, and where it got to.
type Status struct {
	Disabled       bool   `json:"disabled"`
	DisabledReason string `json:"disabledReason,omitempty"`
	Running        bool   `json:"running"`
	LastDeckID     string `json:"lastDeckId,omitempty"`
}

// Runner executes one bounded crawl on demand for a source: probe, claim, walk the feed, diff against what we hold,
// write only the changes, and update the kill switch. The store's claim makes an overlapping invocation a no-op
// rather than a second crawl.
type Runner struct {
	src      Source
	getter   Getter
	store    Store
	log      *slog.Logger
	clientID string
}

func NewRunner(src Source, getter Getter, store Store, log *slog.Logger, clientID string) *Runner {
	return &Runner{src: src, getter: getter, store: store, log: log, clientID: clientID}
}

// Run performs one crawl. A disabled source or an already-running crawl is a Result with no error; an unexpected
// failure is both a Result with a failed summary and an error.
func (r *Runner) Run(ctx context.Context) (Result, error) {
	policy, err := r.store.Policy(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("reading crawl policy: %w", err)
	}
	r.getter.SetPolicy(policy)

	state, err := r.store.CrawlState(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("reading crawl state: %w", err)
	}
	if state.Disabled {
		return Result{Summary: RunSummary{State: "failed", Error: "disabled"}}, nil
	}
	if state.RunningRunID != 0 {
		return Result{AlreadyBusy: true}, nil
	}

	runID, err := r.store.CreateRun(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("creating crawl run: %w", err)
	}
	// The write behind the fast-path AlreadyBusy check is atomic (single-flight lives in the store), so two crons
	// that both pass the check cannot both crawl.
	claimed, err := r.store.Claim(ctx, runID, r.clientID)
	if err != nil {
		return Result{}, fmt.Errorf("claiming crawl: %w", err)
	}
	if !claimed {
		// Another cron won the claim. Finish our own (unclaimed) run row as failed and report busy; nothing crawled.
		if err := r.store.FinishRun(ctx, runID, RunSummary{State: "failed", Error: "already running"}); err != nil {
			r.log.Error("writing unclaimed run", "run", runID, "err", err)
		}
		return Result{RunID: runID, AlreadyBusy: true}, nil
	}
	summary := RunSummary{State: "running"}
	defer func() {
		if err := r.store.FinishRun(ctx, runID, summary); err != nil {
			r.log.Error("writing crawl finish", "run", runID, "err", err)
		}
		if err := r.store.ReleaseClaim(ctx); err != nil {
			r.log.Error("releasing crawl claim", "err", err)
		}
	}()

	existing, err := r.store.ExistingDecks(ctx)
	if err != nil {
		summary.State, summary.Error = "failed", "reading existing decks: "+err.Error()
		return Result{RunID: runID, Summary: summary}, nil
	}

	blocks := r.crawl(ctx, policy, existing, &summary)
	if summary.Error == "" && blocks > 0 {
		summary.Blocks = blocks
	}
	// A single 403 or challenge is a definitive block - the source decided it, so the crawl switches it off until a
	// human re-enables it. Retries are for 429/5xx (done in the fetcher), never for a wall.
	if blocks > 0 {
		reason := fmt.Sprintf("%d blocked response(s)", blocks)
		if err := r.store.Disable(ctx, reason); err != nil {
			r.log.Error("flipping the kill switch", "err", err)
		}
		summary.State, summary.Error = "failed", reason
		return Result{RunID: runID, DisabledBy: reason, Summary: summary}, nil
	}
	if summary.State != "failed" {
		summary.State = "succeeded"
	}
	return Result{RunID: runID, Summary: summary}, nil
}

// Status reads the source's live crawl_state.
func (r *Runner) Status(ctx context.Context) (Status, error) {
	state, err := r.store.CrawlState(ctx)
	if err != nil {
		return Status{}, err
	}
	return Status{
		Disabled:       state.Disabled,
		DisabledReason: state.DisabledReason,
		Running:        state.RunningRunID != 0,
		LastDeckID:     state.LastDeckID,
	}, nil
}

// crawl walks the source's update-ordered feed, diffing each listed deck against the corpus and writing only rows
// that changed. Returns how many 403/challenge blocks were seen - always 0 or 1, because a single definitive block
// ends the run and (via Run) flips the kill switch.
func (r *Runner) crawl(ctx context.Context, policy Policy, existing map[string]DeckRow, summary *RunSummary) int {
	if existing == nil {
		existing = map[string]DeckRow{}
	}
	budget := policy.Budget(len(existing))
	streak := 0
	probed := false

	// The page count is bounded by the budget rather than a fixed cap: a backfill of ten thousand decks needs more
	// pages than a daily run of a few hundred, and a page that lists no decks ends the walk anyway. A page costs one
	// request, so this is also the run's upper bound on listing requests.
	for page := 1; page <= budget && budget > 0; page++ {
		if err := ctx.Err(); err != nil {
			summary.State, summary.Error = "failed", "cancelled"
			return 0
		}
		// A listing page failure is quarantining: the feed moved, or a block is unfolding. A block always ends the
		// run; anything else is a failed-feed run too.
		entries, err := r.listPage(ctx, page)
		if err != nil {
			if isBlockErr(err) {
				return 1
			}
			summary.State, summary.Error = "failed", "listing page: "+err.Error()
			return 0
		}
		summary.PagesSeen++

		// The first successfully served feed page is the connectivity probe: the whole feature gates on an honest
		// fetch of an allowed path working. Record it once per run.
		if !probed {
			probed = true
			if err := r.store.SetProbeOK(ctx); err != nil {
				r.log.Warn("recording probe success", "err", err)
			}
		}

		for _, entry := range entries {
			if budget <= 0 {
				return 0
			}
			budget--
			summary.DecksListed++

			row, err := r.fetchDeck(ctx, entry.ID, summary)
			if err != nil {
				if isBlockErr(err) {
					return 1
				}
				summary.State, summary.Error = "failed", err.Error()
				return 0
			}

			// The diff: a deck we already hold with the same content hash is written to nothing, and counts toward
			// the caught-up rule. Anything else - new or changed - is one write.
			if known, ok := existing[entry.ID]; ok && known.ContentHash == row.ContentHash {
				streak++
				summary.SkippedUnchanged++
				if streak >= caughtUpLimit {
					return 0
				}
				continue
			}
			streak = 0
			if err := r.store.UpsertDecks(ctx, []DeckRow{row}); err != nil {
				summary.State, summary.Error = "failed", "writing deck: "+err.Error()
				return 0
			}
			existing[entry.ID] = row
			summary.DecksWritten++
		}
	}
	return 0
}

func (r *Runner) listPage(ctx context.Context, page int) ([]Entry, error) {
	html, err := r.getter.Get(ctx, r.src.ListURL(page))
	if err != nil {
		return nil, err
	}
	return r.src.ParseList(html)
}

// fetchDeck pulls and parses one deck page and returns the row to compare and write. Always returns a fresh row;
// the caller decides whether it differs from what the corpus already holds.
func (r *Runner) fetchDeck(ctx context.Context, id string, summary *RunSummary) (DeckRow, error) {
	body, err := r.getter.Get(ctx, r.src.DeckURL(id))
	if err != nil {
		return DeckRow{}, err
	}
	deck, err := r.src.ParseDeck(body, id)
	if err != nil {
		return DeckRow{}, err
	}
	summary.DecksFetched++
	if deck.UpdatedAt.IsZero() {
		return DeckRow{}, &ShapeError{What: "deck", Detail: fmt.Sprintf("%s: no update timestamp", id)}
	}
	return DeckRow{
		SourceDeckID:    id,
		Commanders:      deck.Commanders,
		Cards:           deck.Cards,
		ContentHash:     contentHash(deck.Commanders, deck.Cards),
		ListedUpdatedAt: deck.UpdatedAt,
		LastUpdatedAt:   deck.UpdatedAt,
	}, nil
}

// contentHash identifies a deck's content: its commander(s) and its card set. A re-parse yielding the same hash is
// the same deck; that is what a daily run compares against instead of rewriting rows.
func contentHash(commanders, cards []string) string {
	h := sha256.New()
	fmt.Fprint(h, strings.Join(commanders, "|"), "\x00", strings.Join(cards, "|"))
	return hex.EncodeToString(h.Sum(nil))
}

func isBlockErr(err error) bool {
	return errors.As(err, new(*Blocked))
}
