package crawl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Source is the site-specific half of a crawl: how it lists one commander's decks and what its list and deck pages
// mean. Nothing downstream sees the source - the runner works only with what Source answers.
type Source interface {
	// Name is the source key: the app_config policy row, the crawl.state row and the schema its raw decks live in.
	Name() string
	// ListURL is one page of the decks the source lists for a commander, most viewed first: an order that holds
	// still between visits, so page 1 is the same decks tomorrow. (An update-ordered list does not: Archidekt bumps
	// updatedAt faster than a polite crawl can page, which is why the site-wide feed walk this replaced never got
	// past decks edited during the run.)
	ListURL(commanderName string, page int) string
	// DeckURL is one deck's page.
	DeckURL(id string) string
	// ParseList turns a list page body into the decks it listed, in list order. A commander with no decks is an
	// empty page, not an error; a body that is not a list at all is a ShapeError.
	ParseList(body []byte) (ListPage, error)
	// ParseDeck turns a deck page body into the deck's content. id is the entry's ID from the feed.
	//
	// A deck the source can read but that does not belong in the corpus - not Commander, not public, not 100 cards -
	// is a *NotQualified error, which the runner skips quietly. Only a page that stopped looking like itself is a
	// ShapeError, which the runner skips and counts; enough of them end the run.
	ParseDeck(body []byte, id string) (Deck, error)
}

// ListPage is one page of a commander's list.
type ListPage struct {
	Entries []Entry
	// HasNext is whether the source offers another page after this one.
	HasNext bool
}

// Entry is one deck the list showed. Both sources' ids are stable strings (Archidekt's numeric id, Moxfield's slug).
type Entry struct {
	ID string
	// UpdatedAt is the deck's update time as the list showed it; zero when the source's list does not say. A held
	// deck whose listed time has not moved is stepped over without a request.
	UpdatedAt time.Time
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
	// DeclaredBracket is the bracket (1-5) the deck's author gave it, when the source has one. It checks our bracket
	// estimate and never scores (owner decision 2026-10-05).
	DeclaredBracket *int
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

// When skipped decks (missing, or malformed) mean the adapter is broken rather than unlucky. Both have to be exceeded
// together: the share alone would fail a five-deck run that happened to meet three deletions, and the floor alone
// would fail a healthy thousand-deck backfill that met twenty.
const (
	// Below this many, a run concludes nothing: decks really do disappear, or come back odd, in the minutes a crawl takes.
	brokenAdapterFloor = 20
	// Above this share of the decks a run attempted, the feed is not listing what it claims to, or the deck page changed.
	brokenAdapterShare = 0.5
)

// Why a run ended failed: the code of its error ticket (crawl.<source>.run). A run that stopped for time or an empty
// queue has none.
const (
	causeBlocked   = "blocked"   // a 403 or challenge: the kill switch is flipped
	causeAdapter   = "adapter"   // missing or malformed decks past the floor and share, or a streak of failed commanders
	causeDatabase  = "database"  // a crawl RPC failed, so the run cannot record what it does
	causeCancelled = "cancelled" // the process was told to stop (a redeploy, a shutdown)
	causeCrashed   = "crashed"   // a panic, or the crawl never returned
)

// runEnd is how a run ended, for its error ticket: the cause, and the commander it was visiting.
type runEnd struct {
	cause    string
	position string
}

// storeError marks a failed database call inside a visit. Unlike a failed page it ends the run: a crawl that cannot
// read what it holds or write what it fetched would only spend requests.
type storeError struct {
	what string
	err  error
}

func (e *storeError) Error() string { return e.what + ": " + e.err.Error() }
func (e *storeError) Unwrap() error { return e.err }

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
	// The commander queue: never visited, visited at least once, and found nothing under that name.
	CommandersQueued   int `json:"commandersQueued"`
	CommandersVisited  int `json:"commandersVisited"`
	CommandersNotFound int `json:"commandersNotFound"`
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
	// now is the clock the run's deadline is read from; tests replace it.
	now func() time.Time
}

func NewRunner(src Source, getter Getter, store Store, log *slog.Logger, clientID string) *Runner {
	return &Runner{src: src, getter: getter, store: store, log: log, clientID: clientID, now: time.Now}
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
// failure, a recovered panic included, is both a Result with a failed summary and an error.
func (r *Runner) Run(ctx context.Context) (res Result, err error) {
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

	// Runs a dead process left open (a redeploy mid-crawl, a crash) are closed first, with the window the claim uses
	// to call a claim stale. Bookkeeping only: a failed sweep must not stop the crawl.
	if closed, err := r.store.CloseStaleRuns(ctx, policy.StaleClaim); err != nil {
		r.log.Error("closing stale crawl runs", "source", r.src.Name(), "err", err)
	} else if closed > 0 {
		r.log.Warn("closed crawl runs no process owned", "source", r.src.Name(), "runs", closed)
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
	// A claim held by this very run is ours: the store retries a dropped call, and when the first try landed but its
	// reply was lost, the retry finds the claim already taken, by us. Run ids are never reused, so no other run can
	// hold it under this id.
	if !claim.Claimed && claim.HeldBy == runID {
		claim.Claimed = true
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
	var end runEnd
	defer func() {
		// Every return sets succeeded or failed, so a summary still running here means the crawl never returned: a
		// panic (recovered here, logged and not re-raised, so the run still closes) or runtime.Goexit.
		if p := recover(); p != nil {
			summary.State, summary.Error = "failed", fmt.Sprintf("crashed: %v", p)
			end.cause = causeCrashed
			r.log.Error("crawl crashed", "source", r.src.Name(), "run", runID, "panic", p, "stack", string(debug.Stack()))
			res, err = Result{RunID: runID, Summary: summary}, fmt.Errorf("crawl run %d %s", runID, summary.Error)
		} else if summary.State == "running" {
			summary.State, summary.Error = "failed", "interrupted"
			end.cause = causeCrashed
		}
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
		if summary.State == "failed" {
			r.logRunFailure(done, runID, end, summary)
		}
	}()

	// The row says running from the claim on, not queued with zero counters until the run ends hours later.
	if err := r.store.RunProgress(ctx, runID, summary); err != nil {
		r.log.Error("writing crawl progress", "run", runID, "err", err)
	}

	r.crawl(ctx, policy, runID, &summary, &end)
	// A single 403 or challenge is a definitive block - the source decided it, so the crawl switches it off until a
	// human re-enables it. Retries are for 429/5xx (done in the fetcher), never for a wall.
	if end.cause == causeBlocked {
		summary.Blocks = 1
		reason := fmt.Sprintf("%d blocked response(s)", summary.Blocks)
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
		Disabled:           state.Disabled,
		DisabledReason:     state.DisabledReason,
		Running:            state.RunningRunID != 0,
		LastDeckID:         state.LastDeckID,
		DeckCount:          state.DeckCount,
		CommandersQueued:   state.CommandersQueued,
		CommandersVisited:  state.CommandersVisited,
		CommandersNotFound: state.CommandersNotFound,
	}, nil
}

// commanderBatch is how many commanders the run asks the queue for at a time. Small, because a visit takes minutes
// at the polite pace and the queue's order is worth re-reading between batches; large enough that the queue lookups
// are noise next to the crawl.
const commanderBatch = 20

// frontFaceSeparator joins the faces of a two-faced card's name. A source may list such a commander's decks under the
// front face alone, which is the second name a visit tries.
const frontFaceSeparator = " // "

// crawl visits commanders from the queue until the run's time is up or the queue is empty, writing the decks each
// visit finds. A visit that fails on a page costs only that commander; the run ends early only on a block (end.cause
// blocked, and Run flips the kill switch), a broken adapter, a failed database call or a cancellation, and end says
// which and where.
func (r *Runner) crawl(ctx context.Context, policy Policy, runID int64, summary *RunSummary, end *runEnd) {
	fail := func(cause, message string) {
		summary.State, summary.Error, end.cause = "failed", message, cause
	}
	if seeded, err := r.store.SeedCommanders(ctx); err != nil {
		fail(causeDatabase, "seeding the commander queue: "+err.Error())
		return
	} else if seeded > 0 {
		r.log.Info("commander queue seeded", "source", r.src.Name(), "changed", seeded)
	}

	deadline := r.now().Add(policy.RunDuration)
	probed := false
	// The queue leaves out commanders this run already tried, but only once their finish is written; this keeps a
	// failed write from handing the same commander back for ever.
	tried := map[int]bool{}
	failedInRow := 0

	for {
		batch, err := r.store.NextCommanders(ctx, runID, commanderBatch)
		if err != nil {
			fail(causeDatabase, "reading the commander queue: "+err.Error())
			return
		}
		fresh := 0
		for _, commander := range batch {
			if tried[commander.CardID] {
				continue
			}
			fresh++
			tried[commander.CardID] = true
			if err := ctx.Err(); err != nil {
				fail(causeCancelled, "cancelled")
				return
			}
			if !r.now().Before(deadline) {
				return
			}

			end.position = commander.Name
			result, err := r.visit(ctx, policy, commander, deadline, summary, &probed)
			summary.CommandersVisited++
			if err != nil {
				result.Outcome, result.Error = OutcomeFailed, err.Error()
			}
			// Detached, like the run's own closing writes: a cancelled crawl should still say how far this got.
			done, cancel := context.WithTimeout(context.WithoutCancel(ctx), finishTimeout)
			if ferr := r.store.FinishCommander(done, runID, commander.CardID, result); ferr != nil {
				r.log.Error("recording a commander visit", "commander", commander.Name, "err", ferr)
			}
			if perr := r.store.RunProgress(done, runID, *summary); perr != nil {
				r.log.Error("writing crawl progress", "run", runID, "err", perr)
			}
			cancel()
			switch {
			case err != nil && isBlockErr(err):
				end.cause = causeBlocked
				return
			case err != nil && ctx.Err() != nil:
				fail(causeCancelled, "cancelled")
				return
			case err != nil && errors.As(err, new(*storeError)):
				fail(causeDatabase, err.Error())
				return
			case summary.State == "failed": // missing or malformed decks past the floor and share (tooManySkipped)
				end.cause = causeAdapter
				return
			case err != nil && commander.FailedBefore:
				// Failed on its last visit too: evidence about this commander, not the source, so the streak neither
				// grows nor resets.
				r.log.Warn("commander visit failed again; moving on", "source", r.src.Name(), "commander", commander.Name,
					"cardId", commander.CardID, "err", err)
			case err != nil:
				// A list page that errored after the fetcher's retries, or no longer parsed: this commander is failed
				// and the queue moves on. A streak of them is the source or the adapter, not the commanders.
				failedInRow++
				r.log.Warn("commander visit failed; moving on", "source", r.src.Name(), "commander", commander.Name,
					"cardId", commander.CardID, "inRow", failedInRow, "err", err)
				if failedInRow >= policy.MaxFailedCommandersInRow {
					fail(causeAdapter, fmt.Sprintf("%d commander visits in a row failed; the last: %v", failedInRow, err))
					return
				}
			default:
				failedInRow = 0
			}
		}
		if fresh == 0 {
			return
		}
	}
}

// visit lists one commander's decks, most viewed first, and writes the ones that are new or changed.
//
// A first visit reads Policy.FirstVisitPages. A revisit reads page 1 whole, then reads on until it has fetched
// Policy.RevisitNewDecks decks that were new or changed (stopping mid-page once it has), or the list ends (owner rule
// 2026-10-05). Policy.MaxPagesPerCommander and Policy.MaxFetchesPerCommander bound either. A held deck whose listed
// update time has not moved is stepped over without a request, and does not count.
//
// A returned error fails the visit: a list page that errored or stopped looking like itself, or a deck page that
// errored after the fetcher's retries. A block or a *storeError (a failed database call) also ends the run. The result
// still says what the visit did up to that point.
func (r *Runner) visit(ctx context.Context, policy Policy, commander Commander, deadline time.Time, summary *RunSummary, probed *bool) (CommanderResult, error) {
	result := CommanderResult{}
	name := commander.QueryName
	if name == "" {
		name = commander.Name
	}

	page, err := r.listPage(ctx, name, 1)
	if err != nil {
		return result, err
	}
	// A two-faced card may be listed under its front face alone. Only tried when no earlier visit settled the name.
	triedFrontFace := false
	if len(page.Entries) == 0 && commander.QueryName == "" {
		if front, _, ok := strings.Cut(commander.Name, frontFaceSeparator); ok {
			name, triedFrontFace = front, true
			if page, err = r.listPage(ctx, name, 1); err != nil {
				return result, err
			}
		}
	}
	if len(page.Entries) == 0 {
		// The verification log: a commander the seed list knows that this source has nothing for under that name.
		r.log.Warn("commander has no decks on the source", "source", r.src.Name(), "commander", commander.Name,
			"cardId", commander.CardID)
		r.logNotFound(ctx, commander, name, triedFrontFace)
		result.Outcome = OutcomeNotFound
		return result, nil
	}
	result.QueryName = name

	// The first list page that comes back with decks is the connectivity probe: the whole feature gates on an honest
	// fetch of an allowed path working. Record it, and the first deck seen, once per run.
	if !*probed {
		*probed = true
		if err := r.store.SetProbeOK(ctx); err != nil {
			r.log.Warn("recording probe success", "err", err)
		}
		if err := r.store.SetCursor(ctx, page.Entries[0].ID); err != nil {
			r.log.Warn("recording the cursor", "err", err)
		}
	}

	firstVisit := !commander.Visited
	// A first visit's pages, against the absolute ceiling. Whether the ceiling is what stopped it, rather than the pages
	// it was asked to read, decides the outcome: reading your allotted page is `done`, being cut off is `page_cap`.
	firstVisitPages := min(policy.FirstVisitPages, policy.MaxPagesPerCommander)
	ceilingBound := policy.MaxPagesPerCommander < policy.FirstVisitPages
	// Decks this visit fetched because they were new or changed: a revisit reads on until it has its share.
	requested := 0

	for pageNo := 1; ; pageNo++ {
		if pageNo > 1 {
			if !r.now().Before(deadline) {
				result.Outcome = OutcomePartial
				return result, nil
			}
			if page, err = r.listPage(ctx, name, pageNo); err != nil {
				return result, err
			}
		}
		summary.PagesSeen++
		r.notePushback(summary, commander, pageNo)

		// One lookup per page rather than one per commander: a revisit of a big commander can list thousands.
		ids := make([]string, len(page.Entries))
		for i, entry := range page.Entries {
			ids[i] = entry.ID
		}
		held, err := r.store.DeckVersions(ctx, ids)
		if err != nil {
			return result, &storeError{what: "reading held decks", err: err}
		}

		for _, entry := range page.Entries {
			result.Listed++
			summary.DecksListed++
			known, isHeld := held[entry.ID]
			if isHeld && !entry.UpdatedAt.IsZero() && !entry.UpdatedAt.After(known.ListedUpdatedAt) {
				summary.SkippedUnchanged++
				continue
			}
			// Past page 1, a revisit stops as soon as it has its share; page 1 is always read whole.
			if !firstVisit && pageNo > 1 && requested >= policy.RevisitNewDecks {
				result.Outcome = OutcomeDone
				return result, nil
			}
			if !r.now().Before(deadline) {
				result.Outcome = OutcomePartial
				return result, nil
			}

			requested++
			row, err := r.fetchDeck(ctx, entry.ID, summary)
			r.notePushback(summary, commander, pageNo)
			if err != nil {
				if isBlockErr(err) {
					return result, err
				}
				// The list admits decks that are not public 100-card Commander decks; the adapter says which.
				var unqualified *NotQualified
				if errors.As(err, &unqualified) {
					summary.SkippedUnqualified++
					continue
				}
				// Gone since it was listed: deleted, made private, or its id retired in the minutes between.
				// The deck page no longer parses: skipped and counted, so one odd deck costs one deck. Enough of them
				// is the deck page changing, and the run stops rather than skip its way through the corpus.
				var shape *ShapeError
				if errors.As(err, &shape) {
					summary.SkippedMalformed++
					if tooManySkipped(summary.SkippedMalformed, summary.DecksFetched+summary.SkippedMalformed) {
						summary.State = "failed"
						summary.Error = fmt.Sprintf("%d of %d fetched decks were malformed: the deck page changed",
							summary.SkippedMalformed, summary.DecksFetched+summary.SkippedMalformed)
						result.Outcome = OutcomeFailed
						return result, nil
					}
					r.log.Warn("deck page malformed; skipped", "source", r.src.Name(), "deck", entry.ID, "err", err)
					continue
				}
				var httpErr *HTTPError
				if errors.As(err, &httpErr) && (httpErr.Status == http.StatusNotFound || httpErr.Status == http.StatusGone) {
					summary.SkippedMissing++
					if tooManySkipped(summary.SkippedMissing, summary.DecksListed) {
						summary.State = "failed"
						summary.Error = fmt.Sprintf("%d of %d listed decks were missing: the list or the deck API changed",
							summary.SkippedMissing, summary.DecksListed)
						result.Outcome = OutcomeFailed
						return result, nil
					}
					r.log.Info("deck gone since it was listed", "source", r.src.Name(), "deck", entry.ID, "status", httpErr.Status)
					continue
				}
				return result, err
			}
			result.Fetched++
			if !entry.UpdatedAt.IsZero() {
				row.ListedUpdatedAt = entry.UpdatedAt
			}

			// Written even when the cards are unchanged: the database then records only the new listed time, so the
			// next visit steps over the deck instead of fetching it again.
			unresolved, err := r.store.UpsertDecks(ctx, []DeckRow{row})
			if err != nil {
				return result, &storeError{what: "writing deck", err: err}
			}
			// Not stored: an id in it is not an oracle id at all. (A card the catalog merely lacks is stored raw; the
			// collator holds the deck back from the corpus until it resolves.) Nothing is held for it, so the next
			// visit fetches it again.
			if len(unresolved) > 0 {
				summary.SkippedUnresolved++
				r.log.Warn("deck names an id that is not an oracle id; not stored",
					"source", r.src.Name(), "deck", entry.ID, "missing", unresolved[0].Missing)
				if result.Fetched >= policy.MaxFetchesPerCommander {
					result.Outcome = OutcomeFetchCap
					return result, nil
				}
				continue
			}
			if isHeld && known.Hash == row.ContentHash {
				summary.SkippedUnchanged++
				continue
			}
			summary.DecksWritten++
			result.Written++
			// Kept either way - it is a real deck, already paid for - but it only counts toward this commander's
			// target when this commander leads it: the source's commander search also finds decks that merely run
			// the card.
			if slices.Contains(row.Commanders, commander.OracleID) {
				result.Counted++
			} else {
				result.WrongCommander++
			}
			// The page cap does not bound the work on its own: at sixty decks a page, a page cap of forty is 2,400
			// fetches, which at the polite pace is hours. One commander must not be able to take a whole run.
			if result.Fetched >= policy.MaxFetchesPerCommander {
				result.Outcome = OutcomeFetchCap
				return result, nil
			}
		}

		switch {
		case !page.HasNext:
			result.Outcome = visitEnd(commander, result, false, false)
			return result, nil
		case firstVisit && pageNo >= firstVisitPages:
			result.Outcome = visitEnd(commander, result, true, ceilingBound)
			return result, nil
		case !firstVisit && requested >= policy.RevisitNewDecks:
			result.Outcome = OutcomeDone
			return result, nil
		case !firstVisit && pageNo >= policy.MaxPagesPerCommander:
			// Short of its share with the list still going: the ceiling cut it off.
			result.Outcome = OutcomePageCap
			return result, nil
		}
	}
}

// logNotFound opens (or adds to) the commander's error ticket: a commander Scryfall says exists that the source lists
// no decks for is worth a look, a misspelt name or a card the source indexes some other way. Each commander has one
// ticket, so its monthly retries add up there; the last try says the queue gave up on it. A failed ticket write is
// logged and nothing more.
func (r *Runner) logNotFound(ctx context.Context, commander Commander, nameTried string, triedFrontFace bool) {
	area := "crawl." + r.src.Name() + ".not_found"
	since := r.now().UTC()
	if commander.NotFoundSince != nil {
		since = commander.NotFoundSince.UTC()
	}
	message := fmt.Sprintf("%s lists no decks for %s", sourceTitle(r.src.Name()), commander.Name)
	if commander.NotFoundLastTry {
		message += fmt.Sprintf("; given up after %d days", int(r.now().Sub(since)/(hoursPerDay*time.Hour)))
	}
	entry := LogEntry{
		Fingerprint: Fingerprint(area, strconv.Itoa(commander.CardID)),
		Level:       "error",
		Area:        area,
		Code:        OutcomeNotFound,
		Message:     message,
		Detail: map[string]any{
			"cardId":         commander.CardID,
			"oracleId":       commander.OracleID,
			"nameTried":      nameTried,
			"listUrl":        r.src.ListURL(nameTried, 1),
			"triedFrontFace": triedFrontFace,
			"notFoundSince":  since.Format(time.RFC3339),
			"latestNotFound": r.now().UTC().Format(time.RFC3339),
			"givenUp":        commander.NotFoundLastTry,
		},
	}
	if err := r.store.LogError(ctx, entry); err != nil {
		r.log.Error("writing the not_found ticket", "source", r.src.Name(), "commander", commander.Name, "err", err)
	}
}

// logRunFailure opens (or adds to) the ticket for a run that ended failed. One ticket per cause, so a source that
// keeps failing the same way adds up in one place; the detail says which run and how far it got. A failed ticket write
// is logged and nothing more.
func (r *Runner) logRunFailure(ctx context.Context, runID int64, end runEnd, summary RunSummary) {
	area := "crawl." + r.src.Name() + ".run"
	entry := LogEntry{
		Fingerprint: Fingerprint(area, end.cause),
		Level:       "error",
		Area:        area,
		Code:        end.cause,
		Message:     fmt.Sprintf("%s crawl run %d failed: %s", sourceTitle(r.src.Name()), runID, summary.Error),
		Detail: map[string]any{
			"runId":             runID,
			"commandersVisited": summary.CommandersVisited,
			"decksWritten":      summary.DecksWritten,
			"position":          end.position,
		},
	}
	if err := r.store.LogError(ctx, entry); err != nil {
		r.log.Error("writing the failed-run ticket", "source", r.src.Name(), "run", runID, "err", err)
	}
}

// hoursPerDay turns the streak's length into the whole days its ticket reports.
const hoursPerDay = 24

// sourceTitle is a source key as a ticket's message names it: "archidekt" reads "Archidekt".
func sourceTitle(name string) string {
	if name == "" {
		return name
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

// visitEnd names how a visit that read all the pages it was allowed finished.
//
// `page_cap` means the absolute ceiling cut the visit short, not merely that the visit read the pages it was asked to.
// Reading its allotted page is what every healthy first visit does, so reporting that as `page_cap` would make the
// normal case look like a limit was hit and bury the visits where the ceiling really did bite.
func visitEnd(commander Commander, result CommanderResult, hasNext, ceilingBound bool) string {
	switch {
	case !commander.Visited && result.Counted == 0 && result.Fetched > 0:
		// Every deck it fetched was led by another commander or did not qualify: worth a look, like not_found.
		return OutcomeNoLedDecks
	case !hasNext:
		// The commander's list ran out. Nothing more to read, however many pages were allowed.
		return OutcomeExhausted
	case ceilingBound:
		return OutcomePageCap
	default:
		return OutcomeDone
	}
}

// tooManySkipped decides when skipped decks (skipped of attempted) stop being ordinary attrition and start being a
// broken adapter.
//
// Skipping them without a ceiling would trade one loud failure for a silent nightly no-op: if the deck endpoint moved
// or started answering 404 for everyone, every deck would be "gone" and the run would report a cheerful success over
// an empty corpus. The floor exists so a short run cannot conclude anything from bad luck — a handful of decks really
// can disappear, or come back odd, in the minutes a crawl takes.
func tooManySkipped(skipped, attempted int) bool {
	return skipped >= brokenAdapterFloor && float64(skipped) > brokenAdapterShare*float64(attempted)
}

// notePushback records that the source answered 429, and where the crawl was when it did.
//
// The count alone cannot say that: "17 throttles" is a number, while "throttled at Liesa, Forgotten Archangel page 3"
// is where to look. The fetcher owns the counter and widens the pace itself; this only reads it, so a run that was
// slowed down says so in its own row instead of only in the container log.
func (r *Runner) notePushback(summary *RunSummary, commander Commander, page int) {
	seen := r.getter.Throttles()
	if seen <= summary.Throttles {
		return
	}
	summary.Throttles = seen
	summary.ThrottledPosition = fmt.Sprintf("%s page %d", commander.Name, page)
	r.log.Warn("the source pushed back during this run",
		"source", r.src.Name(), "commander", commander.Name, "page", page, "throttles", seen)
}

func (r *Runner) listPage(ctx context.Context, commanderName string, page int) (ListPage, error) {
	body, err := r.getter.Get(ctx, r.src.ListURL(commanderName, page))
	if err != nil {
		return ListPage{}, err
	}
	return r.src.ParseList(body)
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
	if deck.UpdatedAt.IsZero() {
		return DeckRow{}, &ShapeError{What: "deck", Detail: fmt.Sprintf("%s: no update timestamp", id)}
	}
	// Counted only once the page parsed whole, so a malformed deck is a SkippedMalformed and not a fetched deck too.
	summary.DecksFetched++
	return DeckRow{
		SourceDeckID:    id,
		Commanders:      deck.Commanders,
		Cards:           deck.Cards,
		DeckSize:        deck.Size,
		ContentHash:     contentHash(deck.Commanders, deck.Cards),
		ListedUpdatedAt: deck.UpdatedAt,
		LastUpdatedAt:   deck.UpdatedAt,
		DeclaredBracket: deck.DeclaredBracket,
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
