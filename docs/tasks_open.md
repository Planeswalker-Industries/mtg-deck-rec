# Open tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up. Closed tickets are in [`tasks_closed.md`](tasks_closed.md).

Checked against the code and hosted on **2026-10-20**: `main` at PR #156 (the Cut to 100 release), contract v28, hosted migrations at `20261014000100` (`20261020000100`, the slower Archidekt pace, waits for the next release).

Ticket ids are stable and never reused: a closed ticket moves to `tasks_closed.md` as one sentence and leaves a gap. The next new id is T075.

## UI order

The order for the UI work (owner, 2026-10-08), most important first. The tickets below hold the detail.

1. **T071** Deck stats P2 (card types), then **T072** (follow-ups). Deck stats P1 (T045, with T048's role counts) released 2026-10-08 and signed off 2026-10-20.
2. **T069, collection mode:** conflict tags, "stands in for", the swap's `emptyReason`, the built control. The buy list, and with it the deck tool's default to owned only (T037), is shelved (owner, 2026-10-12).
3. **T069, combos and bracket signals**, in Deck stats.
4. **T046** Mana base analysis (contract field first; the catalog column is stored since T073).
5. **T039, T034:** performance, when measurements call for it.
6. **T049** Re-record the How it works clips, once the screens above settle.

---

## Pre-Launch Hard Gates

Must complete before any public launch. These are blockers, not nice-to-haves.

### T002: Configure hosted Supabase Auth

**Priority:** HIGH | **Area:** DevOps | **Status:** Dashboard configured; SMTP pending (T033)

The hosted dashboard steps are done: the URL configuration, the sign-in email template, and `SUPABASE_SECRET_KEY` on Vercel. What remains is deliverability, which needs a real SMTP provider and a domain — that is T033.

**Acceptance criteria:**
- [x] URL configuration and sign-in email template set on hosted
- [x] `SUPABASE_SECRET_KEY` set on Vercel (share-link kill switch)
- [ ] Sign-in email link works on hosted at a usable rate (T033)
- [ ] Share-link kill switch activates on 403/409 responses on hosted (`scripts/share-kill-switch-check.ts` covers it locally)

---


### T028: Decide whether public deck pages get indexed

**Priority:** MEDIUM | **Area:** Product / SEO | **Status:** Undecided

`/decks/[commander]/[code]` is `noindex` today because deck names are user-written and the only moderation is the report link in T003. Indexed deck pages are the project's biggest organic-traffic lever and also its moderation liability — the decision is a launch gate, not a code task.

**Files:**
- `apps/web/src/app/decks/[commander]/[code]/page.tsx` — the `robots` metadata
- `apps/web/src/app/sitemap.ts` — would need deck slugs added if indexed

**Context:** `loadDeckPage` returns null both for missing and for not-permitted decks, and `proxy.ts` gives signed-out visitors a real 404 for both. Indexing would only ever cover public decks.

**Acceptance criteria:**
- [ ] Decide: stay `noindex`, or index public decks behind name moderation
- [ ] If indexing: a moderation path for deck names (report queue, or name filtering), and deck slugs in the sitemap
- [ ] Record the decision and its reason in this ticket

---

## High-Impact Features

### T006: Wire votes into swap scoring

**Priority:** HIGH | **Area:** Backend / Scoring | **Status:** Not started

Votes are cast (`cast_swap_vote`) and stored in `swap_votes`, but nothing reads them for scoring. `app_config.scoring.weights.swap` gives votes 0.1, but `rankSwaps` (`@mtg/core/scoring` `rank.ts`) passes `votes: null` and `voteCount: 0`, so the component never contributes.

**Files:**
- `apps/web/src/lib/server/votes.ts` — vote reading
- `packages/core/src/scoring/rank.ts` — `rankSwaps` (the empty `votes` component); `apps/web/src/lib/server/recs.ts` reads its inputs
- `packages/core/src/scoring/swap.ts` — the vote ramp; weights in `app_config.scoring` (change them only through the evaluation gate, `cli eval:holdout`)
- `packages/core/src/scoring/scoring.test.ts` — existing vote tests

**Context:** The `/rate` rater UI is built. Votes carry `VoteContext` (source, position, candidates shown). The blind swap-quality eval (T014) needs 2 human raters using `/rate`.

**Acceptance criteria:**
- [ ] Read vote counts for (target, replacement) pairs into the swap scoring pipeline
- [ ] Check the existing vote-count ramp against real votes
- [ ] Update existing tests to verify vote influence on rankings
- [ ] Run the swap-quality eval with real raters if possible

**Blocked by:** T014 — weights tuned on no votes are guesses. Collect the eval's votes first, then tune against them.

---

### T032: Deploy the search index to the VPS

**Priority:** HIGH | **Area:** Infrastructure | **Status:** Live (owner confirmed 2026-09-23); follow-up checks open

The index and the search API run on the VPS (two Dokploy stacks, Traefik in front), Vercel reads through it, and the index was rebuilt after #96's schema change. What remains is measurement.

**Files:**
- `deploy/typesense/`, `deploy/search-api/`, `deploy/README.md`
- `deploy/README.md` — the runbook
- `.github/workflows/sync.yml` — reads `SEARCH_API_URL` / `SEARCH_API_ADMIN_TOKEN`

**Acceptance criteria:**
- [x] Both stacks healthy, search-api behind the reverse proxy with TLS, Typesense publishing no port
- [x] Three secrets generated and placed (VPS, worker, Vercel Production and Preview, GitHub Actions)
- [x] `cli:hosted sync:typesense --rebuild` (again after #96)
- [x] `curl https://<host>/v1/health` returns `{"ok":true}` without `-k`
- [x] The daily sync drains the queue (hosted `search_index_queue` empty on 2026-10-07; drains had failed until the domain fix of 2026-09-30)
- [ ] `apps/web/scripts/search-parity-check.ts` passes against hosted data (`commanders` and `commander_cards` have never been exercised with real rows)
- [ ] Measure RAM after the first build (`/metrics.json`) and record it in the runbook

---

### T039: Take votes off the Server Action queue

**Priority:** LOW | **Area:** Frontend / Performance | **Status:** Not started

Server Actions run one at a time per page. Every swipe in the Swap step fires `castVote` (a Server Action), and a running deck lookup polls `getCommanderRequest` every 2 s, so parse, analyze and save calls can queue behind them: Finish's Save waits for every vote swiped before it. Found in the deck-flow audit (PR #110) and left out of its fixes, because it changes a transport rather than fixing a bug.

**Files:**
- `apps/web/src/lib/api/real.ts` — `realActions.castVote`
- `apps/web/src/app/deck/actions.ts` — `castVoteAction`, `getCommanderRequestAction`
- `apps/web/src/lib/server/recs-route.ts` — the route-handler pattern to follow

**Acceptance criteria:**
- [ ] `POST /api/votes` with the `vote` rate-limit bucket and `castVoteInputSchema`; `realActions.castVote` calls it with fetch (the contract interface doesn't change)
- [ ] Decide whether the lookup poll moves the same way
- [ ] Measure Finish's Save after a fast Swap sitting, before and after

---

### T071: Deck stats P2, card types

**Priority:** MEDIUM | **Area:** Database / Worker / Frontend | **Status:** Not started; option A approved (owner, 2026-10-08); T045 released 2026-10-08

Add card types (Creatures, Instants, Sorceries, Artifacts, Enchantments, Planeswalkers) to Deck stats, taking `ok/total` from 8 to 14. Nothing stores how many of each type a commander's decks run today. Approved shape: one `type_profile` jsonb column on `commander_stats`, written by the existing per-commander pass beside `curve_profile` (same row, diff-only, about 0.3 MB), with typical types from the same deck-weighted average `typical_deck_profile()` already computes for the curve. No new table or job.

**Files:**
- `apps/worker/src/lib/key-stats.ts`: count types beside `curveCounts`
- a new migration: the column, and `typical_deck_profile()` returning types too
- `packages/core/src/scoring/stat-targets.ts`, `packages/core/src/journey/deck-tally.ts`: type targets and counts
- `apps/web/src/components/deck/deck-stats/deck-stats-panel.tsx`: a Types group between Curve and Bracket

**Acceptance criteria:**
- [ ] `type_profile` written diff-only by the per-commander pass and filled on hosted by a full pass
- [ ] Types targets on `StatTargets` (contract bump) and counted in the tally, front face only, an artifact creature counted as a creature as Add groups it
- [ ] SQL check in `serving.sql`; tally tests extended
- [ ] Screens re-checked at 390×844 (the sheet grows by six rows; the footer does not)

---

### T072: Deck stats follow-ups

**Priority:** LOW | **Area:** Frontend | **Status:** Not started

Left over from building Deck stats P1 (2026-10-08); none blocks release.

- **Label for a pair with no decks of its own.** When every deck behind the targets is borrowed from the partners' other pairings, the label reads "Tymna & Thrasios decks (0) with partner decks". This is reachable in production (`minDecks` = `fullDecks` = 50: 200 borrowed decks at 0.25 make the share 1). Proposed: "Decks with Tymna or Thrasios" for a pair, "Thrasios decks with a partner" for one commander, kept only for an own count of 0.
- **"Estimated" on the bracket row.** The row checks the chosen bracket against the deck's signals as cards move; owner to confirm the word or drop it.
- **Roles before and after in Finish** (from closed T048): Finish (`review-phase.tsx`) compares curve, card types, Game Changers and price between the original and the new deck, not role counts.
- **Small polish the reviews left:** the sheet's handle scrolls away with its content (make it sticky); the footer has no pointer capture, so a mouse drag that leaves it isn't seen; after a touch swipe the next Enter on the footer is swallowed once; "Pick cuts" does nothing while already in Cut; "Find …" in Cut counts the slots open now rather than after the pending cuts; an add that completed an over-bracket combo stays flagged after the bracket is raised.

**Files:**
- `packages/core/src/scoring/stat-targets.ts` (label)
- `apps/web/src/components/deck/deck-stats/deck-stats-footer.tsx`, `deck-stats-panel.tsx`
- `apps/web/src/components/deck/deck-tool.tsx` (`statAction`), `journey/use-deck-journey.ts` (`overBracketIds`), `journey/review-phase.tsx` (Finish)

**Acceptance criteria:**
- [ ] Owner picks the label wording and the bracket word; both changed
- [ ] Each polish item fixed or struck with a reason

---

### T046: Mana base analysis

**Priority:** MEDIUM | **Area:** Core / Frontend | **Status:** Not started

Placement: Deck stats (T045, signed off 2026-10-20).

Tell the player whether their lands can cast their spells: coloured sources against Frank Karsten's thresholds for each card's pips and turn, a list of the cards least likely to be castable on curve (worst first), and a plain "N sources short on black". This is deterministic arithmetic with no AI. It also fills a gap in Add, which ranks lands by play rate rather than by what the mana base lacks.

**Files:**
- `packages/core/src/journey/deck-stats.ts`: the existing curve and type counts; the analysis belongs beside it in `@mtg/core`, tested
- `packages/core/src/contract/cards.ts`: `CardSummary.manaCost` gives pips
- `apps/worker/src/jobs/` (catalog sync): lands' colour output is not stored today

**Context:**
- **Catalog:** `cards.produced_mana` (Scryfall's list, `{W}` … `{C}`) is stored since T073 (migration `20261014000100`, in `content_hash`); hosted holds it for 2,711 cards (2026-10-20). Nothing sends it to the client yet: that needs a contract field or a separate lookup, which means a contract version bump.
- **Tiers:** start with source counts against Karsten's tables (cheap, exact). A Monte Carlo goldfish (London mulligan, tapped lands, ramp output) is optional on top and would run in a Web Worker like the collection parser. Only build it if Deck stats finds a use for the extra numbers.
- EDHcheck's reference output for the sample Liesa deck: reaches 3 mana by T3 50%, T4 80%, T6 95%; "8 more black sources" for Damn; Avacyn 34.7% on curve. It is a useful sanity check, not ground truth. Its "92% of hands have 2+ lands, so go to 38 lands" advice contradicts itself; don't copy the advice text.
- Threshold tables are published rules of thumb, not tunable weights, so a constants module in `@mtg/core` is fine (coding policy); name the source in a comment.

**Acceptance criteria:**
- [x] Mana production stored per card (column, hash, sync) and loaded on hosted (T073)
- [ ] A contract field (or lookup) that sends it to the client
- [ ] Source-count analysis in `@mtg/core` with tests (hybrid and Phyrexian pips, MDFC lands, commander pips)
- [ ] Display in Deck stats, labelled as an estimate
- [ ] Decide with the owner whether Add should use the shortfall (a land role gap); if so, a separate ticket

---

## Accounts and Collections

### T027: 10k-row collection import timing check

**Priority:** LOW | **Area:** Performance | **Status:** 1,000-row path fixed; 10k check not run

Collections match 2,000 rows per call, so a 10k-row import is five round trips plus the commit. The 1,000-row path was fixed on 2026-09-20 (PRs #56, #58: chunked matching past PostgREST's row cap, short-circuiting match branches, `printings_set_cn_cover`).

**Files:**
- `apps/web/src/app/collection/actions.ts` — `resolveCollectionRowsAction`, `saveCollectionBatchAction`
- `apps/web/scripts/collection-resolve-check.ts` — existing resolver check to extend

**Acceptance criteria:**
- [ ] Re-run a 1,000-row import on hosted and confirm it no longer times out
- [ ] Time a 10,000-row import end to end against the local database
- [ ] Record per-batch resolve time and commit time
- [ ] Confirm no statement times out, and that the browser stays responsive (the parse is in a Web Worker)
- [ ] Record the numbers beside `app_config.collections` so a future limit change has evidence

---

### T033: Hosted custom SMTP and custom domain

**Priority:** MEDIUM | **Area:** DevOps / Auth | **Status:** Not started

Supabase's built-in SMTP sends only a couple of emails an hour and is not for production, so the email-code sign-in path cannot be relied on. Google sign-in covers the owner meanwhile. Moxfield's bot whitelist also wants a production domain (T044).

**Steps:**
1. Point a domain at the app and set it as the custom URL.
2. Resend (free tier) or equivalent: verify the sending domain, then Supabase → Authentication → SMTP.
3. Raise Authentication → Rate Limits → emails per hour past the default.
4. Move the URL settings to the domain: Supabase Site URL and redirect allow list, Vercel `NEXT_PUBLIC_SITE_URL`, and the Google OAuth client's authorized redirect URIs.

**Acceptance criteria:**
- [ ] Custom domain serves the app and is on the Auth redirect allow list
- [ ] Custom SMTP sends sign-in emails at a production rate
- [ ] `NEXT_PUBLIC_SITE_URL` and the Google OAuth redirects updated for the domain

---

### T034: Lazy rendering for large collections in the collection view

**Priority:** LOW | **Area:** Frontend / Performance | **Status:** Tabled (owner, 2026-09-21), revisit when real collections grow

`/collection` renders every card in every open group. Images are already lazy, so the cost is DOM and React work: about ten elements per card. A 729-card collection loads in ~0.6 s; at ~10,000 cards every search keystroke or toggle would rebuild ~100,000 elements.

**Files:**
- `apps/web/src/components/collection/collection-view.tsx` — the groups and the filter memo
- `apps/web/src/components/cards/pocket-grid.tsx` — the grid each group renders

**Options, cheapest first:**
1. `content-visibility: auto` on each group or row. One CSS rule; doesn't reduce React's render work.
2. Render the first N cards per group (around 60) with a "Show N more" button, only for groups over a threshold (around 100). Counts stay exact because filtering runs on data.
3. Virtualise the grid (e.g. TanStack Virtual). Handles 30k cards, but breaks find-in-page and complicates the container-query columns and collapsible headers.

Recommendation: 1 first, 2 when a real collection needs it, 3 only if 2 isn't enough.

**Acceptance criteria:**
- [ ] Measure first: a synthetic 10,000-card browser collection. Time the initial load, a search keystroke and a colour toggle, before and after
- [ ] Apply option 1, and option 2 if the numbers call for it
- [ ] Filter counts stay exact, and collapsing a group still works
- [ ] `e2e/collection.spec.ts` still passes

---

### T037: Tune the owned-first boost

**Priority:** LOW | **Area:** Scoring | **Status:** Ruled 2026-10-05: owned only plus a buy list becomes the default. The data and contract shipped (contract v20); the deck tool keeps owned first until the buy list has a screen (T069)

**Ruling (2026-10-05):** the collection is a filter, as decided on 2026-09-18. The default becomes owned only, with a separate "worth buying" list. Owned first stays shipped until T059 lands, and stays available afterwards only if the evaluation or live data shows players want it; tuning its boost waits until then.

"Owned first" (contract v13) sorts owned cards as if they scored `app_config.ownership.firstBoost` (0.1) higher. On Liesa the top eight creatures to add span 0.78–0.87, so 0.1 puts almost any owned card ahead of nearly every top suggestion. That may be stronger than players want: an owned filler card can outrank a clearly better unowned one.

**Conflicts with an owner decision — needs a ruling before tuning.** T007 records the collection as "a **hard filter**, not a weighted term (owner decision 2026-09-18)", under "Decided, don't re-litigate", with the line "an owned card never outranks a better unowned one". Owned first, shipped 2026-09-22, is exactly such a weighted term. It is also the default: no stored choice means owned first. Owned only still matches the decision, as a hard filter.

Either the 2026-09-22 work superseded the 2026-09-18 decision without it being recorded, or owned first shipped against it. The owner should say which. Then do one of two things:
- Record the new decision and update T007's line, or
- Rethink this ticket: a boost of 0, or a boost that only breaks near-ties.

**Files:**
- `packages/core/src/scoring/owned.ts` — `rankKey`
- `supabase/migrations/20260922000200_ownership_config.sql` — the setting's default
- `apps/web/src/lib/server/recs.ts` — where the setting is read

**Acceptance criteria:**
- [x] Owner rules on the conflict with T007's 2026-09-18 decision (2026-10-05); the ruling is recorded here and in T007
- [ ] Measure how far down owned cards are pulled up across several commanders and real collections
- [ ] Pick a value (or a rule, e.g. a boost that shrinks with the score gap) and record why
- [ ] Change it in `app_config` with a migration that updates only that key

---

## Data Layers and Scoring

One pipeline in layers, then one scoring engine on top. T053–T065 are built and released (PR #140, 2026-10-07; see `tasks_closed.md`), and derived commander pairs (T070) released 2026-10-08 (PR #142). What is open: the worker that runs the pipeline on a schedule (T066), dropping the retired functions (T067) and the review's follow-ups (T068), and the UI the sprint shelved (T069).

### T066: VPS worker

**Priority:** HIGH | **Area:** Worker / Ops | **Status:** Released 2026-10-07 with the scoring pipeline; not deployed (hosted's `worker_status` heartbeat last moved 2026-09-16)

The worker container on the VPS (`deploy/worker/`, `deploy/dokploy/worker.yml`) runs the jobs that run by hand today, on a schedule in `app_config.worker`: deck lookups every pass, each source's daily crawl at `crawlHourUtc` (T042), `collate` every `collateEveryMinutes` followed by the precompute worker's passes (T055: the commanders whose decks changed, substitutes as they come due, roles and combo pieces when their inputs move), the nightly baseline at `baselineHourUtc`, and `sync:edhrec` every `edhrecEveryDays` in the background (retried after `retryHours` when a fetch didn't finish). Deck lookups (T009) go through the crawl: a requested commander comes first in the crawl's queue, and the worker starts a crawl run when none is going, so there is one Archidekt client with one politeness and kill-switch implementation.

**Carried over from PR #128:** the container (`apps/worker/Dockerfile`, `.dockerignore`) and deploy files, and `cli serve`, rewritten. **Its review fixes:**
- a lookup's rebuild runs the ordinary aggregate, sanity gate included;
- lookups honour Archidekt's kill switch and 403s, because the crawl serves them;
- an empty `SEARCH_API_CRON_TOKEN` falls back to the admin token;
- the worker holds no crawl claim, so there is none to release on shutdown.

**Verified locally (2026-10-05):** the lookup flow with the crawl's visit simulated (done with 102 decks, `not_enough_decks` for a commander the crawl found none for, failed with the reason while Archidekt was switched off); the crawl trigger against a stub of the search API, with an empty cron token; the image builds (603 MB) and a container pass runs against the local database.

**Acceptance criteria:**
- [ ] The worker deployed on the VPS with `DATABASE_URL` (session pooler), the search API tokens, `WEB_APP_URL` and `REVALIDATE_SECRET`
- [x] Schedule in `app_config.worker`; `worker_status` heartbeat every 10 s for the deck tool
- [x] Deck lookups served through the crawl queue (closes T009 once deployed)
- [ ] Two days of worker-triggered crawls, then the Vercel cron (`apps/web/vercel.json`, `/api/cron/*-scrape`) goes; it has started a run in its hour every day since 2026-10-02 (since 2026-10-15 most of them end on a 429: T074)
- [ ] Before the first weekly global pair count: a memory limit on the container and a Node heap flag (T068)

---

### T067: Drop the retired rec functions

**Priority:** MEDIUM | **Area:** Database | **Status:** Open; the release is live (PR #140, 2026-10-07) | **Blocked by:** the owner no longer wanting a rollback to the previous build

PR #139 stopped calling `rec_add_candidates` (both overloads), `rec_swap_candidates`, `rec_card_roles` and `log_rec_timeout`, but its migrations go out before its code, and until then production runs the previous build, which falls back to them when `app_config.recs` is missing. So `20261006000200` drops nothing (review, 2026-10-07). A new migration drops them with `rec_timeouts` and the `recs` row, and `supabase/tests/serving.sql` checks they're gone again.

---

### T068: Scoring pipeline review follow-ups (PR #139)

**Priority:** HIGH | **Area:** Data / Ops / Scoring | **Status:** Open (review 2026-10-07; release checks the same day)

PR #139's review found these; the fixes in the PR itself are migration `20261007000100` and the commits after it. Left open:

**For the pipeline to run on its own in production (the PR's goal):**
- [ ] Deploy the VPS worker (T066): hosted's `worker_status` heartbeat last moved 2026-09-16, there is one hand-run collation (2026-10-06: `corpus.decks` holds 79,759 decks while the crawl has stored 224,407 in `archidekt.decks` by 2026-10-20; the last precompute pass ran 2026-10-08), and nothing runs the precompute passes, collation, EDHREC or deck lookups on a schedule
- [ ] Spellbook on hosted: set the repository variable `SPELLBOOK_SYNC_ENABLED` (hosted's `spellbook.*`, `corpus.spellbook_combos` and `spellbook_combo_pieces` are empty, so "complete a combo" and the combo bracket rules answer nothing), then `collate --only spellbook` and `precompute --part combos`
- [ ] A first `sync:edhrec` on hosted (raw `edhrec.*` is empty; the prior reads the 2026-09-30 import until then), then the next evaluation on the time split with `--snapshot-month` set to the new fetch
- [ ] Estimator agreement with declared brackets in `eval:holdout`'s report: hosted's crawl has stored 4,449 since T056 (2026-10-07)
- [ ] Substitutes: every list is due once since the release (the hash gained the pool weights and reads idf to two places). Skipped on hosted on 2026-10-07: the stored lists are already right (the same recompute locally wrote 0 rows), so it can wait for the worker's two-minute slices or an off-peak `cli:hosted precompute --part substitutes` (about 90 minutes of database time)

**Latency (release check, 2026-10-07, same deck, the previous and new builds interleaved):** adds 212/243 → 306/400 ms at p50/p95, cuts 123/209 → 188/288, swaps 252/286 → 283/326. The new per-request reads cost it, card pairs most (`serving_deck_affinity`: 174 ms and 253 KB for an add, 132 ms and 114 KB with no neighbours, timed from this PC):
- [ ] Skip the card-pairs read where it can't change the result: cuts while `affinity.lowAffinityCuts` is off, swaps while their `deck` weight is 0
- [ ] Skip `serving_commander_profile` while `skeleton.edhrecPrior` is off
- [ ] Send an add only the pairs that point at its pool and neighbours, and each card's row once; or cache each card's corpus pairs for days

**Storage (8 GB disk, 3.4 GB used before the release; measured locally, projected at 6× the decks):**
- [x] Pairs that borrow from their partners hold 3.56M of 5.76M score rows (62%), and grow fastest: about 16M rows (2.4 GB) at 6× the decks, about 8.4 GB for the whole database. Built and released as derived pairs (T070, 2026-10-08)
- [ ] `card_substitutes` is 1.15 GB (15.7M rows, about 510 per card): one row per card with id and similarity arrays would be about a tenth, and the depth (220) was set for parity with the retired path, which no longer binds; the evaluation doesn't grade swaps yet
- [ ] `rec_events` grows with traffic and nothing purges it: a retention period (owner decision, and a `/privacy` line) and a worker purge
- [ ] The global pair count's memory grows with the corpus (about 1.1 GB peak locally; a 1 GB counter alone at 6×): count in row blocks with a bounded top list per card, or raise `globalMinDecks` with the corpus; give the worker container a memory limit and a Node heap flag

**Scoring and evaluation:**
- [ ] Cuts rank by the hand-weighted cut score, not m(c | D − c); either move them and gate it (cut precision@10), or record that cuts keep `scoreCuts`
- [ ] The gate's bucket rule compares with the baseline's own interval, not the paired change, so a significant drop in a small bucket can pass; judge each bucket on its paired difference
- [ ] The evaluation's holdout hash (FNV-1a over sequential ids) clusters the random split; the evaluation ranks every deck as bracket 3 without the bracket facts; cut precision counts only planted cards; collection recall and the buy list aren't gated; nothing compares its TypeScript copy of the precompute arithmetic with the stored tables
- [ ] The global pair lift barely shrinks rare cards (a third of kept corpus pairs have under 10 decks) and isn't release-aware; record why it deviates
- [ ] Owned twins: copies a built deck holds are matched per card, not pooled across the twin group (`availability.ts`)
- [ ] The per-key pair pass picks keys by `commander_stats.computed_at`, which moves only when a key's aggregates do and is stamped at transaction start; drive it from the keys the commander pass merged

---

### T069: Scoring UI (shelved during the sprint)

**Priority:** MEDIUM | **Area:** Frontend | **Status:** Shelved until the data work is done (owner, 2026-10-06); the data, scoring and contract for each item are live

UI for what T059, T060, T063 and T065 built, gathered here when those closed. Shelved UI means custom components; plumbing, copy lines and plain admin lists were allowed and are built.

- **Collection mode (T059):** the built control and whole-deck coverage (conflicts, stand-ins, browser quantities) are built, not released. Buy lists are shelved (owner, 2026-10-12; buy side shows placeholders). Remaining features: per-suggestion ownership labels, builder/saved-page coverage and the deck tool's default from 'first' to 'only' (T037, parked).
- **Swap with nothing owned:** the swipe rater says "No replacements do the same job" for every empty list; the server already says why (`SwapResult.emptyReason`: `NOTHING_OWNED_FITS`, `NO_TAGS_ON_TARGET`, `NO_CANDIDATES`), and with a collection the buy list is where to send the player
- **Bracket rules and combos (T060):** the "complete a combo" group, `completesOverBracket` on a suggestion, `DeckAnalysis.combos` and `bracketSignals` (placement: Deck stats); credit and link Commander Spellbook wherever combos show
- **Build mode (T063):** built: the commander picker on `/deck?start=build` (owned commanders first), the built deck by category, the basics to gather, the feasibility report, a bracket rebuild, fitting a pasted list to the collection, copy and download (T050). Open: each card's score and origin, "complete a combo" entries, the build's bracket estimate, saving a build directly, and build accept-rate events. The value fill waits with the buy side
- **Accept rate (T065):** a built deck records as mode `build` once build mode has a screen

**Acceptance criteria:**
- [ ] Each group above has a screen, checked at 390×844 within the swipe budget
- [ ] The deck tool defaults to owned only once the buy list shows (T037)

---

### T070: Derived commander pairs

**Priority:** HIGH | **Area:** Database / Worker | **Status:** Released 2026-10-08 (PR #142); live on hosted

A commander pair is a query context, not a dataset (owner, 2026-10-07). A keyed pair with fewer than `minDecks` decks of its own borrows every other key of either partner, and `commander_card_scores` held a row for every card those keys ran: on hosted, 1,060 such pairs held 3.54M of 5.77M rows (61%; Vial Smasher + Bruse Tarl, 1 deck, 5,216 rows), each partner's decks copied once per pairing and rewritten whenever they changed. Now such a pair stores only its pool order (the first `pairPoolDepth`, 650, eligible cards) and its EDHREC listings, and a request derives its counts from the pair's own `commander_card_stats` row and both partners' `partner_card_totals`. Owner decisions (2026-10-07): `card_pairs` stays pruned (every observed pair would be about 33M rows, 2.4 GB); single commanders under 50 decks stay stored; the worker keeps the pool order (hybrid); under 1 s with no compute upgrade.

**Verified locally (2026-10-08):** 1,023 pairs derived; `commander_card_scores` 5.76M → 2.37M rows, 810 → 333 MB after `vacuum full`, plus 97 MB for the pool and listings (430 MB in all). For 50 derived pairs and 6 stored controls, adds, cuts, swaps, builds and every card's rates matched the stored path exactly; the 500-card commander-page pool reordered 234 card pairs whose pool scores differ by under 0.001 (max 0.00088), which the old rows held stale within the worker's write tolerance. The add pool for Vial Smasher + Bruse Tarl reads in about 12 ms, the same as a stored pair. SQL checks pass (`serving.sql` has a derived-pair section). `eval:holdout` (seeded split) reads the same with derivation on and off: adds recall@20 26.0%, cuts precision@10 26.7%, collection recall 51.2% (the stored depth never binds there).

**Released on hosted (2026-10-08):** 1,056 pairs derived; the scores pass staged 2.28M rows (3.53M removed), `commander_card_scores` 1.41 GB → 321 MB on `vacuum full`, database 4,202 MB → 3,111 MB. Migration `20261008000100` reached hosted with `db-push.yml`; the flip was by hand (`cli:hosted precompute --part scores --force`) because the VPS worker (T066) is not deployed.

**Acceptance criteria:**
- [x] Release: migration `20261008000100` to hosted (`db-push.yml`) with the web code that reads it. With the VPS worker (T066) undeployed, the flip was by hand: `cli:hosted precompute --part scores --force` derived every pair at once, since the migration set `app_config.precompute.pairPoolDepth`
- [x] On hosted after the flip: `vacuum full public.commander_card_scores` at a quiet time (2026-10-08), 1.41 GB → 321 MB
- [ ] Hosted parity on a few derived pairs (adds, cuts, swaps) before and after the flip
- [ ] Follow-up: cache the most requested derived pairs' counts if their reads ever show in latency

---

## Data Pipeline

### T074: Archidekt answers the daily crawl with 429s

**Priority:** HIGH | **Area:** Data / Ops | **Status:** Slower base pace in migration `20261020000100` (owner, 2026-10-20); not released

After weeks of clean runs at one request a second, five of the six daily Archidekt runs from 2026-10-15 to 2026-10-20 (`crawl.runs` 22–27; 25 the exception) failed on an HTTP 429 the fetcher's backoff did not outlast, most of them within the first hour and on a commander's first listing page. Run 20 (2026-10-13) still reads `running`: it was cut off, probably by a VPS redeploy. The fetcher already doubles its interval on a 429 up to `requestIntervalMaxMs` (8 s) and returns to the base after `paceRecoverRequests` clean responses, so a base it keeps being throttled at is the wrong base. CLAUDE.md's rule is to go slower when a host pushes back; a 403 or a challenge would switch the source off instead.

**Files:**
- `supabase/migrations/20261020000100_archidekt_slower_pace.sql`: `app_config.archidekt.requestIntervalMs` 1000 → 2000, nothing else
- `services/search-api/internal/crawl/fetcher.go`: the adaptive pace and the retries
- `services/search-api/internal/archidekt/source.go`: why the pace adapts

**Acceptance criteria:**
- [ ] The migration on hosted (release, then `db-push.yml` if the integration doesn't apply it)
- [ ] Three daily runs in a row at the new pace without a 429 failure; if they still fail, switch the source off and ask Archidekt's staff what rate they want
- [ ] Run 20 closed as failed (by the crawl's stale-run handling or by hand), and a redeploy that kills a run leaves it marked failed

---

### T043: A database role for the crawl that is not `service_role`

**Priority:** MEDIUM | **Area:** Security / Infrastructure | **Status:** Not started

The VPS container holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS across the whole database, `auth` included, in the same process that serves public read endpoints. The `public.crawl_*` functions narrow what the crawl *does*, not what the key *could* do. Split out of closed T036.

**Files:**
- `services/search-api/internal/config/config.go` — `SupabaseServiceKey`
- `supabase/migrations/20260922000300_deck_crawl_corpus.sql` — the `crawl_*` functions and their grants
- `deploy/README.md` — the secrets tables

**Acceptance criteria:**
- [ ] A Postgres role granted execute on the `crawl_*` functions and nothing else
- [ ] A JWT minted for that role (Supabase's secret keys all map to `service_role`), placed on the VPS in place of the service-role key
- [ ] `TestLiveStoreRoundTrip` passes with the new role, and a direct table read with it is refused
- [ ] The secrets table in `deploy/README.md` updated

---

### T044: Moxfield crawl access

**Priority:** LOW | **Area:** Data | **Status:** Blocked on Moxfield

The Moxfield adapter (`services/search-api/internal/moxfield/`) is built and seeded disabled: on 2026-09-22 it answered Cloudflare's hard WAF block (403) from the VPS on a robots.txt-allowed path. The guardrails say a block is obeyed, not worked around. Moxfield's bot whitelist wants a production domain (T033). Split out of closed T036.

**Acceptance criteria:**
- [ ] Moxfield grants an accessible path
- [ ] A probe from the VPS returns 2xx
- [ ] Parsers pinned against live fixtures (the deck parser refuses anything that is not exactly 100 cards until then)
- [ ] `disabled` cleared for the source

---

### T009: Always-on commander request consumer

**Priority:** MEDIUM | **Area:** Backend / Worker | **Status:** Built into the VPS worker (T066, released 2026-10-07); live once the worker is deployed | **Blocked by:** T066

Deck lookups queue in `commander_requests`, and nothing consumes them. The worker that did, `serve:commander-requests`, ran by hand from the owner's PC and wrote decks into the old deck spike's file; it had been offline since 2026-09-16 and was retired on 2026-10-05 with the rest of the spike code. T066 serves lookups through the crawl: a requested commander goes to the front of the crawl's queue, and the VPS worker starts a crawl run when the claim is free.

**Files:**
- `apps/worker/src/jobs/lookups.ts`, `serve.ts` (T066)
- `public.crawl_next_commanders` (requested commanders first)

**Acceptance criteria:**
- [ ] Deploy the consumer as a long-running process or scheduled job
- [ ] Verify `commander_requests` are consumed within reasonable time (hosted, 2026-10-20: 2 queued since 2026-09-28)
- [ ] Monitor the `worker_status` heartbeat from the UI

---

### T030: Invalid commander-pair `commander_keys` rows

**Priority:** LOW | **Area:** Data | **Status:** Known issue

Some `commander_keys` rows name two cards that aren't a legal partner pair (Archidekt's Commander category also holds companions and misfiled cards). Collation now drops those decks (`invalid_partner_pair`, from `isValidPartnerPair`), so the rows survive with no stats attached and render an empty commander page.

**Files:**
- `packages/core/src/formats/commander/corpus.ts:57` — where collation rejects the pair
- `packages/core/src/formats/commander/validate.ts` — `isValidPartnerPair`
- `apps/worker/src/jobs/aggregate-corpus.ts` — writes `commander_keys`

**Acceptance criteria:**
- [ ] List the keys whose commanders aren't a legal pair and which have no `commander_stats` row
- [ ] Decide: delete them, or mark them so pages and `proxy.ts` treat them as missing
- [ ] Stop `aggregate:corpus` creating new ones
- [ ] Delete only the differing rows, never a table rewrite

---

### T041: Reclaim dead space on hosted

**Priority:** LOW | **Area:** Database | **Status:** Started: `commander_card_scores` vacuumed 2026-10-08 (T070); `printings` and `search_index_queue` remain

Read 2026-10-07: `printings` is 166 MB on hosted against 56 MB locally (English-only since 2026-09-21 deleted about 425k rows, and daily price updates add more), and `search_index_queue` holds 199 MB with no rows. `commander_card_scores` grew from 799 MB to 1.41 GB when the release rewrote every score once; its `vacuum full` ran 2026-10-08 as part of T070 (1.41 GB → 321 MB), taking hosted from 4.16 GB to 3.11 GB.

**Acceptance criteria:**
- [ ] `vacuum full` on `printings` and `search_index_queue` on hosted as superuser (a human, not the read-only role), at a quiet time: it locks the table
- [x] `commander_card_scores` vacuumed 2026-10-08 with T070 (1.41 GB → 321 MB)
- [ ] Record the before and after sizes in this ticket (re-read 2026-10-20: `printings` 166 MB and `search_index_queue` 199 MB unchanged; database 3,305 MB)

---

## Testing

### T013: k6 load testing

**Priority:** LOW | **Area:** Performance | **Status:** Not started

No load testing done. Targets: p95 uncached swap < 800 ms, add/cut < 1 s at 50 rps.

**Acceptance criteria:**
- [ ] Write k6 scripts for swap, add, cut endpoints
- [ ] Run against local Supabase
- [ ] Document results and bottlenecks

---

### T014: Blind swap-quality eval (Phase 0 open item)

**Priority:** MEDIUM | **Area:** Quality | **Status:** Not started

Needs 2 human raters, 50 cases × 5 commanders, precision@5 + MRR. The `/rate` rater UI is built.

**Files:**
- `apps/web/src/app/rate/`, `apps/web/src/components/rater/` — rater UI
- `apps/web/src/app/deck/actions.ts` — `castVoteAction`

**Context:** The last open Phase 0 gate, and the only one that needs people rather than code. The rater deals a card's top 6 replacements shuffled with our ranking hidden. Its votes are also the data T006 needs.

**Acceptance criteria:**
- [ ] Recruit 2 raters
- [ ] Run 50 cases × 5 commanders
- [ ] Measure precision@5 and MRR
- [ ] Record the results in this ticket

**Blocks:** T006.

---

### T015: SQL tests for collection imports

**Priority:** LOW | **Area:** Testing | **Status:** Partly covered

`supabase/tests/collection-editing.sql` covers hand edits (`set_collection_card_quantity`) and that a user edits only their own collection. The import functions and their limits have no SQL tests; `saved-decks.sql` is the model to follow.

**Acceptance criteria:**
- [ ] Owner can read and delete their own collection rows, not another user's
- [ ] Test `start_collection_import`, `save_collection_rows`, `commit_collection_import` (merge and replace)
- [ ] Test limits: `maxImportRows`, `maxEntries`, `maxOpenImports`
- [ ] Add the run command to `CLAUDE.md`

---

### T051: Local e2e failures with real data

**Priority:** LOW | **Area:** Testing | **Status:** Not started

Three e2e tests fail locally against the real catalog and corpus, on `develop` as well as `feat/kitchen-table-lane` (checked 2026-09-29):
- `home.spec.ts` "pointing at a ring slice names it in the centre": hovering the top of the deck wheel never names the lands slice.
- `deck-journey.spec.ts` "the Cut list crosses out recommended cuts…" (and on `develop` also the full walk and the Replace tap test): Chulane has no local corpus, so the commander-lookup sheet opens after `analyzeDeck` has already tried to dismiss it, and blocks the page.
- `deck-tool.spec.ts` "a name search's next page continues the list" (seen 2026-10-06) fails without a search index: the first page comes from `search_cards` and a later one (any offset) from `search_cards_filtered`, which rank differently, so cards repeat across pages. The index ranks both the same way. Players never meet it (checked 2026-10-08): since the deckbuilder redesign the search panel always sends `sort`, so its first page is a filtered search too and every page comes from one ranking. Only an API caller paging without `sort`, the test itself, sees the switch (`card-search.ts`: `offset > 0` makes a search filtered).

**Files:**
- `apps/web/e2e/home.spec.ts`, `apps/web/e2e/deck-journey.spec.ts`
- `apps/web/src/components/home/deck-overview.tsx` — the ring's pointer handling

**Acceptance criteria:**
- [ ] `analyzeDeck` waits for either the recommendations or the lookup sheet before dismissing, as the page walk scripts do
- [x] The ring test: removed in the 2026-10-13 e2e trim (a hover cosmetic)
- [x] A later page of a name search ranks the way the first did when the search index is down: the test pages with `sort=name_asc`, as the deckbuilder does
- [ ] Both specs pass locally with `E2E_LOCAL_DATA=1` and in CI (mocks)

---

## Future / Lower Priority

### T003: Deck report link destination

**Priority:** LOW | **Area:** Frontend / UX | **Status:** Shelved until the app is released to public users (owner, 2026-10-19); do not raise it before then

The "Report" link on public deck pages opens a prefilled GitHub issue. Needs a real destination before public launch.

**Files:**
- `apps/web/src/app/decks/[commander]/[code]/page.tsx:145` — the `github.com/Planeswalker-Industries/mtg-deck-rec/issues/new` link

**Acceptance criteria:**
- [ ] Decide destination (email, form, in-app feedback)
- [ ] Update the link
- [ ] Remove GitHub issue template reference if present

---

### T049: Re-record the How it works clips

**Priority:** LOW | **Area:** Frontend / Content | **Status:** Not started (owner)

The three How it works recordings (`apps/web/public/add.png`, `cut_gif*.gif`, `swipe_gif*.gif`) show the old slate UI and the old step names and order (Cut, Add, Replace, Review). The steps are now Add, Cut, Swap and Finish, and the page has used the cool blue palette since 2026-10-13 (PR #149).

**Acceptance criteria:**
- [ ] Record Add, Cut and Swap in the current look, one clip per step, same pixel size across the three (`StepMedia` in `components/home/how-it-works.tsx`)
- [ ] Keep a `_hi` version for 1024 px and up
- [ ] Check file sizes: the clips load lazily but are still megabytes

---

### T017: Favorites

**Priority:** LOW | **Area:** Frontend / Backend | **Status:** Not started

Save favorite cards or decks for quick access.

**Acceptance criteria:**
- [ ] Schema for favorites table
- [ ] UI to add/remove favorites
- [ ] Favorites page

---

### T018: Precon import

**Priority:** LOW | **Area:** Data / Worker | **Status:** Not started

Import preconstructed deck lists. Needs MTGJSON license verification first.

**Acceptance criteria:**
- [ ] Verify MTGJSON license allows redistribution
- [ ] Import precon data
- [ ] Map precon cards to oracle cards

---

### T021: Retune partnerPoolWeight

**Priority:** LOW | **Area:** Scoring | **Status:** Not started

`partnerPoolWeight` 0.25 was calibrated on only 4 commander pairs (all including Rograkh). Retune when more pair data exists.

**Files:**
- `app_config.corpus.partnerPoolWeight` — the value; `pickCorpusSources` (`packages/core/src/scoring/corpus.ts`) applies it
- `cli eval:holdout` — any retune goes through the gate

**Acceptance criteria:**
- [ ] Re-run corpus stability with more partner pair data
- [ ] Adjust `partnerPoolWeight` if partner pair coverage improves
- [ ] Update `app_config.corpus` in database

---

## Technical Debt

### T022: Play rate amplifying weak tag matches

**Priority:** LOW | **Area:** Scoring | **Status:** Known issue

Reliquary Tower tops Sea Gate Restoration swaps at 51% play rate despite a 0.65 tag score. Play rate can lift weak tag matches above stronger ones.

**Files:**
- `app_config.scoring` — swap weights and `swap.tagSimilarityFloor`
- `packages/core/src/scoring/rank.ts` — `rankSwaps`

**Acceptance criteria:**
- [ ] Investigate whether a tag-score floor or play-rate dampening is needed
- [ ] Test with regression fixtures
- [ ] Document decision
