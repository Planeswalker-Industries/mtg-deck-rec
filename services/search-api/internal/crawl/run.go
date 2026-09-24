package crawl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
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
	//
	// A deck the source can read but that does not belong in the corpus - not Commander, not public, not 100 cards -
	// is a *NotQualified error, which the runner skips quietly. Only a page that stopped looking like itself is a
	// ShapeError, which quarantines the run.
	ParseDeck(body []byte, id string) (Deck, error)
}

// Entry is one deck id the feed listed. Both sources' ids are stable strings (Archidekt's numeric id, Moxfield's
// slug).
type Entry struct {
	ID string
}

// Deck is one parsed deck: commander(s) and the other cards with their quantities, oracle-level, plus its
// authoritative update time.
type Deck struct {
	ID             string
	CommanderNames []string
	Commanders     []string       // oracle ids, sorted so a partner pair keys deterministically
	Cards          map[string]int // the rest of the 100: oracle id to number of copies
	Size           int            // total copies including the commander(s)
	UpdatedAt      time.Time
}

// NotQualified means the page parsed but the deck is not one the corpus wants. It is an ordinary outcome of walking
// a feed - the browse filters are not a guarantee - so it is counted, not raised.
type NotQualified struct {
	ID     string
	Reason string
}

func (e *NotQualified) Error() string {
	return fmt.Sprintf("deck %s does not qualify: %s", e.ID, e.Reason)
}

// caughtUpLimit unchanged decks in a row means the feed has passed the frontier of what the corpus already holds
// (the feed is update-ordered, newest first). Past it, every listing is an old, unchanged deck.
const caughtUpLimit = 10

// When missing decks mean the feed is broken rather than merely stale. Both have to be exceeded together: the share
// alone would fail a five-deck run that happened to meet three deletions, and the floor alone would fail a healthy
// thousand-deck backfill that met twenty.
const (
	// Below this many, a run concludes nothing: decks really do disappear in the minutes a crawl takes.
	missingDeckFloor = 20
	// Above this share of the decks a run attempted, the feed is not listing what it claims to.
	missingDeckShare = 0.5
)

// finishTimeout bounds the bookkeeping writes that close a run. They run on a context detached from the crawl's, so
// a shutdown or a cancelled crawl still records its outcome and releases its claim instead of leaving the source
// locked until the stale window expires.
const finishTimeout = 15 * time.Second

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
	DeckCount      int    `json:"deckCount"`
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

// Preflight makes the one read Run would make first, so a caller can find out whether this crawl can reach its
// database *before* it commits to a background run it will never hear about again.
//
// It exists because a scrape answers 202 and then crawls detached: a total configuration failure — a rejected service
// key, a wrong SUPABASE_URL, no egress — looked exactly like a healthy start, and the only trace was one line in the
// container log. A cron that cannot see failure is a cron nobody notices has stopped. Measured the hard way: a crawl
// that had not run since 2026-09-14 was found by reading pg_stat_statements.
//
// Deliberately the same call as Run's first (the policy read), so the two cannot drift into "preflight passes, run
// fails". It is one round trip and it returns nothing: the run reads the policy again for itself a moment later,
// because between the two the answer is allowed to change.
func (r *Runner) Preflight(ctx context.Context) error {
	if _, err := r.store.Policy(ctx); err != nil {
		return fmt.Errorf("reading crawl policy: %w", err)
	}
	return nil
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

	runID, err := r.store.CreateRun(ctx)
	if err != nil {
		return Result{}, fmt.Errorf("creating crawl run: %w", err)
	}
	// The claim is the only thing that decides whether this run crawls. There is no fast-path read of
	// running_run_id first: it would be a check with a gap in front of the write, and the claim already answers the
	// same question atomically.
	claim, err := r.store.Claim(ctx, runID, r.clientID, policy.StaleClaim)
	if err != nil {
		return Result{}, fmt.Errorf("claiming crawl: %w", err)
	}
	if !claim.Claimed {
		// Another cron holds the claim. Close our own (unclaimed) run row and report busy; nothing crawled.
		if err := r.store.FinishRun(ctx, runID, RunSummary{State: "failed", Error: "already running"}); err != nil {
			r.log.Error("writing unclaimed run", "run", runID, "err", err)
		}
		return Result{RunID: runID, AlreadyBusy: true}, nil
	}
	if claim.TookOver {
		// Normal after a deploy lands mid-crawl, but worth saying out loud: the previous run died without releasing.
		r.log.Warn("took over a stale crawl claim", "source", r.src.Name(), "run", runID)
	}

	summary := RunSummary{State: "running"}
	defer func() {
		// Detached from ctx on purpose: these two writes are how a run stops being "running", so they have to
		// survive the cancellation that ended the crawl.
		done, cancel := context.WithTimeout(context.WithoutCancel(ctx), finishTimeout)
		defer cancel()
		if err := r.store.FinishRun(done, runID, summary); err != nil {
			r.log.Error("writing crawl finish", "run", runID, "err", err)
		}
		if err := r.store.ReleaseClaim(done, runID); err != nil {
			r.log.Error("releasing crawl claim", "err", err)
		}
	}()

	blocks := r.crawl(ctx, policy, state, &summary)
	// A single 403 or challenge is a definitive block - the source decided it, so the crawl switches it off until a
	// human re-enables it. Retries are for 429/5xx (done in the fetcher), never for a wall.
	if blocks > 0 {
		summary.Blocks = blocks
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
		DeckCount:      state.DeckCount,
	}, nil
}

// crawl walks the source's update-ordered feed, diffing each listed deck against the corpus and writing only rows
// that changed. Returns how many 403/challenge blocks were seen - always 0 or 1, because a single definitive block
// ends the run and (via Run) flips the kill switch.
func (r *Runner) crawl(ctx context.Context, policy Policy, state CrawlState, summary *RunSummary) int {
	budget := policy.Budget(state.DeckCount)
	streak := 0
	probed := false

	// The page count is bounded by the budget rather than a fixed cap: a backfill of ten thousand decks needs more
	// pages than a daily run of a few hundred. A page costs one request, so this is also the run's upper bound on
	// listing requests.
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
		// The end of the feed. Sources quarantine an empty page today, but the walk must not depend on that: a feed
		// that starts answering with an empty list would otherwise be paged all the way to the budget.
		if len(entries) == 0 {
			return 0
		}

		// The first successfully served feed page is the connectivity probe: the whole feature gates on an honest
		// fetch of an allowed path working. Record it, and where the feed starts, once per run.
		if !probed {
			probed = true
			if err := r.store.SetProbeOK(ctx); err != nil {
				r.log.Warn("recording probe success", "err", err)
			}
			if err := r.store.SetCursor(ctx, entries[0].ID); err != nil {
				r.log.Warn("recording the feed cursor", "err", err)
			}
		}

		// One lookup per page rather than one per run: the corpus is the thing that grows without bound, and a run
		// only needs to know about the decks in front of it.
		ids := make([]string, len(entries))
		for i, entry := range entries {
			ids[i] = entry.ID
		}
		known, err := r.store.DeckHashes(ctx, ids)
		if err != nil {
			summary.State, summary.Error = "failed", "reading deck hashes: "+err.Error()
			return 0
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
				// A deck that does not belong in the corpus is not a failure: the browse filters admit decks that
				// are not public 100-card Commander decks, and the source adapter is what says so.
				var unqualified *NotQualified
				if errors.As(err, &unqualified) {
					summary.SkippedUnqualified++
					continue
				}
				// A deck that is gone. The feed is update-ordered and this loop runs at one request a second, so
				// minutes pass between a deck being listed and being fetched; in that window it can be deleted, made
				// private or have its id retired. That is ordinary at this rate, and it used to abort the whole run.
				var httpErr *HTTPError
				if errors.As(err, &httpErr) && (httpErr.Status == http.StatusNotFound || httpErr.Status == http.StatusGone) {
					summary.SkippedMissing++
					if feedMostlyMissing(summary) {
						summary.State = "failed"
						summary.Error = fmt.Sprintf("%d of %d listed decks were missing: the feed or the deck API changed",
							summary.SkippedMissing, summary.DecksListed)
						return 0
					}
					r.log.Info("deck gone since the feed listed it", "source", r.src.Name(), "deck", entry.ID, "status", httpErr.Status)
					continue
				}
				summary.State, summary.Error = "failed", err.Error()
				return 0
			}

			// The diff: a deck we already hold with the same content hash is written to nothing, and counts toward
			// the caught-up rule. Anything else - new or changed - is one write.
			if hash, ok := known[entry.ID]; ok && hash == row.ContentHash {
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
			summary.DecksWritten++
		}
	}
	return 0
}

// feedMostlyMissing decides when missing decks stop being ordinary attrition and start being a broken adapter.
//
// Skipping them without a ceiling would trade one loud failure for a silent nightly no-op: if the deck endpoint moved
// or started answering 404 for everyone, every deck would be "gone" and the run would report a cheerful success over
// an empty corpus. The floor exists so a short run cannot conclude anything from bad luck — a handful of decks really
// can disappear in the minutes a crawl takes.
func feedMostlyMissing(s *RunSummary) bool {
	return s.SkippedMissing >= missingDeckFloor && float64(s.SkippedMissing) > missingDeckShare*float64(s.DecksListed)
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
		DeckSize:        deck.Size,
		ContentHash:     contentHash(deck.Commanders, deck.Cards),
		ListedUpdatedAt: deck.UpdatedAt,
		LastUpdatedAt:   deck.UpdatedAt,
	}, nil
}

// contentHash identifies a deck's content: its commander(s) and its cards with their quantities. A re-parse yielding
// the same hash is the same deck; that is what a daily run compares against instead of rewriting rows.
//
// Both halves are sorted before hashing, so the hash describes the deck and not the order the source happened to
// list it in. An unsorted hash would rewrite every row whenever a site reshuffled its card list.
func contentHash(commanders []string, cards map[string]int) string {
	sortedCommanders := append([]string(nil), commanders...)
	sort.Strings(sortedCommanders)

	ids := make([]string, 0, len(cards))
	for id := range cards {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	pairs := make([]string, len(ids))
	for i, id := range ids {
		pairs[i] = id + ":" + strconv.Itoa(cards[id])
	}

	h := sha256.New()
	fmt.Fprint(h, strings.Join(sortedCommanders, "|"), "\x00", strings.Join(pairs, "|"))
	return hex.EncodeToString(h.Sum(nil))
}

func isBlockErr(err error) bool {
	return errors.As(err, new(*Blocked))
}
