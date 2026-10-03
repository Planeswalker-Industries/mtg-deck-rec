package crawl

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Source is the site-specific half of a crawl: how it lists one commander's decks and what its list and deck pages
// mean. Nothing downstream sees the source - the runner works only with what Source answers.
type Source interface {
	// Name is the source key: the app_config policy row, the corpus.crawl_state row and the decks' source column.
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
	// ShapeError, which quarantines the run.
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

	blocks := r.crawl(ctx, policy, runID, &summary)
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
// visit finds. Returns how many 403/challenge blocks were seen - always 0 or 1, because a single definitive block
// ends the run and (via Run) flips the kill switch.
func (r *Runner) crawl(ctx context.Context, policy Policy, runID int64, summary *RunSummary) int {
	if seeded, err := r.store.SeedCommanders(ctx); err != nil {
		summary.State, summary.Error = "failed", "seeding the commander queue: "+err.Error()
		return 0
	} else if seeded > 0 {
		r.log.Info("commander queue seeded", "source", r.src.Name(), "changed", seeded)
	}

	deadline := r.now().Add(policy.RunDuration)
	probed := false
	// The queue leaves out commanders this run already tried, but only once their finish is written; this keeps a
	// failed write from handing the same commander back for ever.
	tried := map[int]bool{}

	for {
		batch, err := r.store.NextCommanders(ctx, runID, commanderBatch)
		if err != nil {
			summary.State, summary.Error = "failed", "reading the commander queue: "+err.Error()
			return 0
		}
		fresh := 0
		for _, commander := range batch {
			if tried[commander.CardID] {
				continue
			}
			fresh++
			tried[commander.CardID] = true
			if err := ctx.Err(); err != nil {
				summary.State, summary.Error = "failed", "cancelled"
				return 0
			}
			if !r.now().Before(deadline) {
				return 0
			}

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
			cancel()
			switch {
			case err != nil && isBlockErr(err):
				return 1
			case err != nil:
				summary.State, summary.Error = "failed", err.Error()
				return 0
			case summary.State == "failed": // the list or the deck API stopped answering (feedMostlyMissing)
				return 0
			}
		}
		if fresh == 0 {
			return 0
		}
	}
}

// visit lists one commander's decks, most viewed first, and writes the ones that are new or changed.
//
// A first visit reads Policy.FirstVisitPages; a revisit walks on until Policy.NewDecksPerRevisit decks led by this
// commander were new or changed, the list ends, or Policy.MaxPagesPerCommander. A held deck whose listed update time
// has not moved is stepped over without a request.
//
// A returned error ends the run (a block, a list that stopped looking like itself, a failed write); the result
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
	if len(page.Entries) == 0 && commander.QueryName == "" {
		if front, _, ok := strings.Cut(commander.Name, frontFaceSeparator); ok {
			name = front
			if page, err = r.listPage(ctx, name, 1); err != nil {
				return result, err
			}
		}
	}
	if len(page.Entries) == 0 {
		// The verification log: a commander the seed list knows that this source has nothing for under that name.
		r.log.Warn("commander has no decks on the source", "source", r.src.Name(), "commander", commander.Name,
			"cardId", commander.CardID)
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

	wanted := policy.RevisitPages
	if !commander.Visited {
		wanted = policy.FirstVisitPages
	}
	maxPages := min(wanted, policy.MaxPagesPerCommander)
	// Whether the absolute ceiling is what stopped the visit, rather than the pages it was asked to read. The two are
	// different outcomes: reading your allotted page is `done`, being cut off by the ceiling is `page_cap`.
	ceilingBound := policy.MaxPagesPerCommander < wanted

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
			return result, fmt.Errorf("reading held decks: %w", err)
		}

		for _, entry := range page.Entries {
			result.Listed++
			summary.DecksListed++
			known, isHeld := held[entry.ID]
			if isHeld && !entry.UpdatedAt.IsZero() && !entry.UpdatedAt.After(known.ListedUpdatedAt) {
				summary.SkippedUnchanged++
				continue
			}
			if !r.now().Before(deadline) {
				result.Outcome = OutcomePartial
				return result, nil
			}

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
				var httpErr *HTTPError
				if errors.As(err, &httpErr) && (httpErr.Status == http.StatusNotFound || httpErr.Status == http.StatusGone) {
					summary.SkippedMissing++
					if feedMostlyMissing(summary) {
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
				return result, fmt.Errorf("writing deck: %w", err)
			}
			// Not stored: it names a card the catalog does not have yet. Nothing is held for it, so the next visit
			// fetches it again, by which time the daily catalog sync has normally caught up.
			if len(unresolved) > 0 {
				summary.SkippedUnresolved++
				r.log.Warn("deck names a card the catalog does not have; not stored",
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

		if !page.HasNext || pageNo >= maxPages {
			result.Outcome = visitEnd(commander, result, page.HasNext, ceilingBound)
			return result, nil
		}
	}
}

// visitEnd names how a visit that read all the pages it was allowed finished.
//
// `page_cap` means the absolute ceiling cut the visit short, not merely that the visit read the pages it was asked to.
// With revisitPages at 1 the latter is what every healthy revisit does, so reporting that as `page_cap` would make the
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

// feedMostlyMissing decides when missing decks stop being ordinary attrition and start being a broken adapter.
//
// Skipping them without a ceiling would trade one loud failure for a silent nightly no-op: if the deck endpoint moved
// or started answering 404 for everyone, every deck would be "gone" and the run would report a cheerful success over
// an empty corpus. The floor exists so a short run cannot conclude anything from bad luck — a handful of decks really
// can disappear in the minutes a crawl takes.
func feedMostlyMissing(s *RunSummary) bool {
	return s.SkippedMissing >= missingDeckFloor && float64(s.SkippedMissing) > missingDeckShare*float64(s.DecksListed)
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
