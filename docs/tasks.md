# Tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up.

> **Keep the four project docs in step.** This file is the queue. [`roadmap/status.md`](roadmap/status.md) is the narrative (current state and why), [`../CLAUDE.md`](../CLAUDE.md) holds repo-wide rules, and [`../apps/web/AGENTS.md`](../apps/web/AGENTS.md) holds web-app detail. Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

Checked against the code and hosted on **2026-10-07**: `main` at PR #140 (the scoring pipeline release), contract v25, hosted migrations at `20261007000100`.

Ticket ids are stable and never reused: a closed ticket leaves a gap rather than renumbering the ones after it.

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

### T003: Deck report link destination

**Priority:** MEDIUM | **Area:** Frontend / UX | **Status:** Not started

The "Report" link on public deck pages opens a prefilled GitHub issue. Needs a real destination before public launch.

**Files:**
- `apps/web/src/app/decks/[commander]/[code]/page.tsx:138` — the `github.com/Planeswalker-Industries/mtg-deck-rec/issues/new` link

**Acceptance criteria:**
- [ ] Decide destination (email, form, in-app feedback)
- [ ] Update the link
- [ ] Remove GitHub issue template reference if present

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
- [ ] Record the decision and its reason in `status.md`

---

## High-Impact Features

### T006: Wire votes into swap scoring

**Priority:** HIGH | **Area:** Backend / Scoring | **Status:** Not started

Votes are cast (`cast_swap_vote`) and stored in `swap_votes`, but nothing reads them for scoring. `app_config.scoring.weights.swap` gives votes 0.1, but `rankSwaps` (`@mtg/core/scoring` `rank.ts`) passes `votes: null` and `voteCount: 0`, so the component never contributes.

**Files:**
- `apps/web/src/lib/server/votes.ts` — vote reading
- `packages/core/src/scoring/rank.ts` — `rankSwaps` (the empty `votes` component); `apps/web/src/lib/server/recs.ts` reads its inputs
- `packages/core/src/scoring/swap.ts` — the vote ramp; weights in `app_config.scoring` (change them only through the evaluation gate, CLAUDE.md)
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
- `docs/roadmap/typesense-ops.md` — the runbook
- `.github/workflows/sync.yml` — reads `SEARCH_API_URL` / `SEARCH_API_ADMIN_TOKEN`

**Acceptance criteria:**
- [x] Both stacks healthy, search-api behind the reverse proxy with TLS, Typesense publishing no port
- [x] Three secrets generated and placed (VPS, worker, Vercel Production and Preview, GitHub Actions)
- [x] `cli:hosted sync:typesense --rebuild` (again after #96)
- [x] `curl https://<host>/v1/health` returns `{"ok":true}` without `-k`
- [x] The daily sync drains the queue (hosted `search_index_queue` empty on 2026-10-07; drains had failed until the domain fix of 2026-09-30)
- [ ] `scripts/search-parity-check.ts` passes against hosted data (`commanders` and `commander_cards` have never been exercised with real rows)
- [ ] Measure RAM after the first build (`/metrics.json`) and record it in the runbook

---

### T039: Take votes off the Server Action queue

**Priority:** LOW | **Area:** Frontend / Performance | **Status:** Not started

Server Actions run one at a time per page. Every swipe in the Replace phase fires `castVote` (a Server Action), and a running deck lookup polls `getCommanderRequest` every 2 s, so parse, analyze and save calls can queue behind them: Review's Save waits for every vote swiped before it. Found in the deck-flow audit (PR #110) and left out of its fixes, because it changes a transport rather than fixing a bug.

**Files:**
- `apps/web/src/lib/api/real.ts` — `realActions.castVote`
- `apps/web/src/app/deck/actions.ts` — `castVoteAction`, `getCommanderRequestAction`
- `apps/web/src/lib/server/recs-route.ts` — the route-handler pattern to follow

**Acceptance criteria:**
- [ ] `POST /api/votes` with the `vote` rate-limit bucket and `castVoteInputSchema`; `realActions.castVote` calls it with fetch (the contract interface doesn't change)
- [ ] Decide whether the lookup poll moves the same way
- [ ] Measure Review's Save after a fast Replace sitting, before and after

---

### T045: Design the deck analysis display

**Priority:** MEDIUM | **Area:** Product / UX | **Status:** Not started

First part of the deck analysis work (T046, T048, and the combos and bracket signals in T069), and it comes first: decide where and how the new numbers are shown before building any of them. Came out of a look at EDHcheck (edhcheck.com, 2026-09-28) with the sample Liesa deck. Its functions are solid (mana simulation, per-card cast rates, combo detection, bracket explorer), but the page is a wall of panels, invented composite scores and upsells. We want the useful numbers, shown only where they change what the player does next.

**Files:**
- `apps/web/src/components/deck/journey/review-phase.tsx`: Review (shown as "Done") already shows before/after curve, card types, Game Changers and price (`deckStats`, `@mtg/core/journey`)
- `apps/web/src/components/deckbuilder/deck-builder.tsx`: the deckbuilder's own `deckStats` summary
- `apps/web/src/components/deck/deck-bar.tsx` (the `DeckBar`): the two-line phone budget in AGENTS.md ("`/deck` on a phone is budgeted for the swipe view")
- `docs/ui_concepts/`: where earlier concepts live

**Questions to answer:**
- Where each figure lives: DeckBar, Cut, Add, Review, the Deckbuilder, or a separate analysis view. It must not break the 390×844 swipe budget.
- How each figure drives an action, for example "4 black sources short" leading into Add with lands filtered, "combo pushes this to bracket 4" leading into Cut, or "2 ramp below Liesa decks" leading into Add for that role.
- Before and after: Review already compares both decks, so the new figures should do the same.
- What we deliberately leave out: salt (never stored, see CLAUDE.md), 1–10 power levels and radar charts (invented composites), AI-written text, upsells, legality in other formats.
- Wording for estimates: simulated and estimated numbers are labelled as such, like the bracket estimate is today.
- Fit the "Kitchen Table" design direction (the UI section of `apps/web/AGENTS.md`): numbers in DM Mono, a card-first view rather than stat tables, and a plain-words "why" in the italic aside where a figure explains a suggestion.

**Acceptance criteria:**
- [ ] A concept (screens or a POC per `docs/ui_concepts/`) for phone and desktop covering T046, T048 and T069's bracket and combo items
- [ ] Owner sign-off on placement and on what is left out
- [ ] T046, T048 and T069 updated with the agreed placement

---

### T046: Mana base analysis

**Priority:** MEDIUM | **Area:** Core / Frontend | **Status:** Not started

**Blocked by:** T045 (display)

Tell the player whether their lands can cast their spells: coloured sources against Frank Karsten's thresholds for each card's pips and turn, a list of the cards least likely to be castable on curve (worst first), and a plain "N sources short on black". This is deterministic arithmetic with no AI. It also fills a gap in Add, which ranks lands by play rate rather than by what the mana base lacks.

**Files:**
- `packages/core/src/journey/deck-stats.ts`: the existing curve and type counts; the analysis belongs beside it in `@mtg/core`, tested
- `packages/core/src/contract/cards.ts`: `CardSummary.manaCost` gives pips
- `apps/worker/src/jobs/` (catalog sync): lands' colour output is not stored today

**Context:**
- **Catalog gap:** nothing stores what mana a land (or rock) produces. Scryfall's `produced_mana` covers it. A new catalog column must go into `content_hash`, or existing rows never fill (CLAUDE.md, "Writing data"). It also needs a contract field or a separate lookup, which means a contract version bump.
- **Tiers:** start with source counts against Karsten's tables (cheap, exact). A Monte Carlo goldfish (London mulligan, tapped lands, ramp output) is optional on top and would run in a Web Worker like the collection parser. Only build it if T045 finds a use for the extra numbers.
- EDHcheck's reference output for the sample Liesa deck: reaches 3 mana by T3 50%, T4 80%, T6 95%; "8 more black sources" for Damn; Avacyn 34.7% on curve. It is a useful sanity check, not ground truth. Its "92% of hands have 2+ lands, so go to 38 lands" advice contradicts itself; don't copy the advice text.
- Threshold tables are published rules of thumb, not tunable weights, so a constants module in `@mtg/core` is fine (coding policy); name the source in a comment.

**Acceptance criteria:**
- [ ] Mana production stored per card (column, hash, sync, contract field) and loaded on hosted
- [ ] Source-count analysis in `@mtg/core` with tests (hybrid and Phyrexian pips, MDFC lands, commander pips)
- [ ] Display per T045, labelled as an estimate
- [ ] Decide with the owner whether Add should use the shortfall (a land role gap); if so, a separate ticket

---

### T048: Role counts against the commander's decks

**Priority:** MEDIUM | **Area:** Frontend / Core | **Status:** Not started

**Blocked by:** T045 (display)

Show the deck's ramp, draw, removal, wipes and other `deck_role_targets` roles next to what decks for this commander usually run ("12 ramp; Liesa decks average 10"). EDHcheck shows only generic percentages (ramp 8.8%, draw 19.1%); comparing against the commander's own decks is something only our corpus can do.

**Files:**
- `apps/web/src/lib/server/recs.ts`: `roleTargetsFor` already blends generic targets toward `commander_stats.role_profile` by `commanderShare`
- `apps/web/src/lib/server/corpus.ts`, `commander-page.ts`: where `role_profile` is read today
- `packages/core/src/contract/transport.ts`: the commander page's `roleProfile` shape (`{ tag, avgPerDeck }`)
- `packages/core/src/contract/decks.ts`: `DeckAnalysis` has no role counts yet

**Context:** The numbers exist. Cut redundancy and Add's role gap already use them, but the player never sees them. Use the same blended targets `roleTargetsFor` produces so the display and the recommendations agree. A commander with few decks falls back to generic targets. Say so in the display rather than presenting a generic number as "Liesa decks". Partner pooling applies as it does for play rates.

**Acceptance criteria:**
- [ ] The deck's count per role and the blended target reach the client (contract version bump if on `DeckAnalysis`)
- [ ] Display per T045, before and after in Review
- [ ] Wording distinguishes commander data from generic targets
- [ ] Tests for the counting, which mirrors `card_roles`

---

### T050: Start a deck from one commander

**Priority:** MEDIUM | **Area:** Frontend / Product | **Status:** Not started

The home page's "Sound familiar?" ribbon offers "+ Commander" for a player who just pulled a legend. It links to `/deck` for now, where they have to paste the commander as a one-line list; Add then fills the open slots. There is no way to pick a commander by name.

**Files:**
- `apps/web/src/components/home/situations.tsx` — the "+ Commander" link (`href: "/deck"`)
- `apps/web/src/components/deck/deck-tool.tsx` — the decklist box and Analyze
- `apps/web/src/components/search/site-search.tsx` — the existing card and commander search

**Context:** A one-card deck already works: Add fills `openSlots` (room below 100 cards), so the gap is only the way in. Pick a commander, and the tool opens with that commander analyzed and Add ready. `/deck?start=build` already does this for the Deckbuilder (`buildFrom` in `deck-tool.tsx`); this task is the same start landing in Upgrade's Add. The commander's own page (`/commander/[slug]`) could offer the same.

**Acceptance criteria:**
- [ ] A commander picker (search by name, commander-legal only) that opens `/deck` with that commander analyzed
- [ ] "+ Commander" in the ribbon points to it
- [ ] Works on a phone at 390×844 without leaving the swipe budget
- [ ] e2e: pick a commander, land in Add with open slots

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

**Ruling (2026-10-05):** the collection is a filter, as decided on 2026-09-18. The default becomes owned only, with a separate "worth buying" list ([`roadmap/scoring-design.md`](roadmap/scoring-design.md), Mode A). Owned first stays shipped until T059 lands, and stays available afterwards only if the evaluation or live data shows players want it; tuning its boost waits until then.

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
- [x] Owner rules on the conflict with T007's 2026-09-18 decision (2026-10-05); the ruling is recorded here, in T007 and in `scoring-design.md`
- [ ] Measure how far down owned cards are pulled up across several commanders and real collections
- [ ] Pick a value (or a rule, e.g. a boost that shrinks with the score gap) and record why
- [ ] Change it in `app_config` with a migration that updates only that key

---

### T038: Start a collection by hand

**Priority:** LOW | **Area:** Frontend / Collections | **Status:** Not started

Editing by hand (contract v15) works only on a collection that already exists. With none, `/collection` shows "No collection yet" and links to `/collection/import`. A player with a handful of cards has no way in except making a file or a paste.

**Files:**
- `apps/web/src/components/collection/collection-view.tsx` — the empty state
- `apps/web/src/components/collection/collection-edit.tsx`, `use-collection-editor.ts` — the edit mode and its writes
- `packages/core/src/collection/` — `setCardQuantity` for a browser collection

**Acceptance criteria:**
- [ ] The empty state offers "Add cards by hand" beside the import
- [ ] Signed in: the first added card creates the account collection through `set_collection_card_quantity` (check it accepts an account with no rows)
- [ ] Signed out: the first added card creates a browser collection with the usual 7-day expiry
- [ ] e2e covers starting from empty

---

## Data Layers and Scoring

One pipeline in layers, then one scoring engine on top: [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md) (data) and [`roadmap/scoring-design.md`](roadmap/scoring-design.md) (scoring). T053–T065 are built and released (PR #140, 2026-10-07; closed below). What is open: the worker that runs the pipeline on a schedule (T066), dropping the retired functions (T067), the review's follow-ups (T068) and the UI the sprint shelved (T069).

### T066: VPS worker

**Priority:** HIGH | **Area:** Worker / Ops | **Status:** Released 2026-10-07 with the scoring pipeline; not deployed (hosted's `worker_status` heartbeat last moved 2026-09-16)

The worker container on the VPS (`deploy/worker/`, `deploy/dokploy/worker.yml`) runs the jobs that run by hand today, on a schedule in `app_config.worker`: deck lookups every pass, each source's daily crawl at `crawlHourUtc` (T042), `collate` every `collateEveryMinutes` followed by the precompute worker's passes (T055: the commanders whose decks changed, substitutes as they come due, roles and combo pieces when their inputs move), the nightly baseline at `baselineHourUtc`, and `sync:edhrec` every `edhrecEveryDays` in the background (retried after `retryHours` when a fetch didn't finish). Deck lookups (T009) go through the crawl: a requested commander comes first in the crawl's queue, and the worker starts a crawl run when none is going, so there is one Archidekt client with one politeness and kill-switch implementation. CLAUDE.md ("Commander deck lookups", "Hosting") has the rules.

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
- [ ] Two days of worker-triggered crawls, then the Vercel cron (`vercel.json`, `/api/cron/*-scrape`) goes; it has started a run in its hour every day since 2026-10-02
- [ ] Before the first weekly global pair count: a memory limit on the container and a Node heap flag (T068)

---

### T067: Drop the retired rec functions

**Priority:** MEDIUM | **Area:** Database | **Status:** Open; the release is live (PR #140, 2026-10-07) | **Blocked by:** the owner no longer wanting a rollback to the previous build

PR #139 stopped calling `rec_add_candidates` (both overloads), `rec_swap_candidates`, `rec_card_roles` and `log_rec_timeout`, but its migrations go out before its code, and until then production runs the previous build, which falls back to them when `app_config.recs` is missing. So `20261006000200` drops nothing (review, 2026-10-07). A new migration drops them with `rec_timeouts` and the `recs` row, and `supabase/tests/serving.sql` checks they're gone again. `docs/diagnostics/rec-timeout-triage.sql` goes with them.

---

### T068: Scoring pipeline review follow-ups (PR #139)

**Priority:** HIGH | **Area:** Data / Ops / Scoring | **Status:** Open (review 2026-10-07; release checks the same day)

PR #139's review found these; the fixes in the PR itself are migration `20261007000100` and the commits after it. Left open:

**For the pipeline to run on its own in production (the PR's goal):**
- [ ] Deploy the VPS worker (T066): hosted's `worker_status` heartbeat last moved 2026-09-16, there is one hand-run collation, and nothing runs the precompute passes, collation, EDHREC or deck lookups on a schedule
- [ ] Spellbook on hosted: set the repository variable `SPELLBOOK_SYNC_ENABLED` (hosted's `spellbook.*`, `corpus.spellbook_combos` and `spellbook_combo_pieces` are empty, so "complete a combo" and the combo bracket rules answer nothing), then `collate --only spellbook` and `precompute --part combos`
- [ ] A first `sync:edhrec` on hosted (raw `edhrec.*` is empty; the prior reads the 2026-09-30 import until then), then the next evaluation on the time split with `--snapshot-month` set to the new fetch
- [ ] Estimator agreement with declared brackets in `eval:holdout`'s report: hosted's crawl has stored 4,449 since T056 (2026-10-07)
- [ ] Substitutes: every list is due once since the release (the hash gained the pool weights and reads idf to two places). Skipped on hosted on 2026-10-07: the stored lists are already right (the same recompute locally wrote 0 rows), so it can wait for the worker's two-minute slices or an off-peak `cli:hosted precompute --part substitutes` (about 90 minutes of database time)

**Latency (release check, 2026-10-07, same deck, the previous and new builds interleaved):** adds 212/243 → 306/400 ms at p50/p95, cuts 123/209 → 188/288, swaps 252/286 → 283/326. The new per-request reads cost it, card pairs most (`serving_deck_affinity`: 174 ms and 253 KB for an add, 132 ms and 114 KB with no neighbours, timed from this PC):
- [ ] Skip the card-pairs read where it can't change the result: cuts while `affinity.lowAffinityCuts` is off, swaps while their `deck` weight is 0
- [ ] Skip `serving_commander_profile` while `skeleton.edhrecPrior` is off
- [ ] Send an add only the pairs that point at its pool and neighbours, and each card's row once; or cache each card's corpus pairs for days, as `card-graph-plan.md` planned

**Storage (8 GB disk, 3.4 GB used before the release; measured locally, projected at 6× the decks):**
- [ ] Pairs that borrow from their partners hold 3.56M of 5.76M score rows (62%), and grow fastest: about 16M rows (2.4 GB) at 6× the decks, about 8.4 GB for the whole database. Store only a pair's own and EDHREC rows and combine the borrowed part per request from `partner_card_totals`, as a pair no key knows already is
- [ ] `card_substitutes` is 1.15 GB (15.7M rows, about 510 per card): one row per card with id and similarity arrays would be about a tenth, and the depth (220) was set for parity with the retired path, which no longer binds; the evaluation doesn't grade swaps yet
- [ ] `rec_events` grows with traffic and nothing purges it: a retention period (owner decision, and a `/privacy` line) and a worker purge
- [ ] The global pair count's memory grows with the corpus (about 1.1 GB peak locally; a 1 GB counter alone at 6×): count in row blocks with a bounded top list per card, or raise `globalMinDecks` with the corpus; give the worker container a memory limit and a Node heap flag

**Scoring and evaluation:**
- [ ] Cuts rank by the hand-weighted cut score, not m(c | D − c) as `scoring-design.md` designs; either move them and gate it (cut precision@10), or record that cuts keep `scoreCuts`
- [ ] The gate's bucket rule compares with the baseline's own interval, not the paired change, so a significant drop in a small bucket can pass; judge each bucket on its paired difference
- [ ] The evaluation's holdout hash (FNV-1a over sequential ids) clusters the random split; the evaluation ranks every deck as bracket 3 without the bracket facts; cut precision counts only planted cards; collection recall and the buy list aren't gated; nothing compares its TypeScript copy of the precompute arithmetic with the stored tables
- [ ] The global pair lift barely shrinks rare cards (a third of kept corpus pairs have under 10 decks) and isn't release-aware; record the deviations from `card-graph-plan.md` "Statistics"
- [ ] Owned twins: copies a built deck holds are matched per card, not pooled across the twin group (`availability.ts`)
- [ ] The per-key pair pass picks keys by `commander_stats.computed_at`, which moves only when a key's aggregates do and is stamped at transaction start; drive it from the keys the commander pass merged

---

### T069: Scoring UI (shelved during the sprint)

**Priority:** MEDIUM | **Area:** Frontend | **Status:** Shelved until the data work is done (owner, 2026-10-06); the data, scoring and contract for each item are live

UI for what T059, T060, T063 and T065 built, gathered here when those closed. Shelved UI means custom components; plumbing, copy lines and plain admin lists were allowed and are built.

- **Collection mode (T059):** the built control on the deck page (`set_deck_built`), the buy list and conflict tags in the deck tool, a stand-in's "stands in for" line, browser collections sending quantities, then the deck tool's default from 'first' to 'only' (only once the buy list shows, or 'only' hides every unowned card with nothing in their place; T037)
- **Swap with nothing owned:** the swipe rater says "No replacements do the same job" for every empty list; the server already says why (`SwapResult.emptyReason`: `NOTHING_OWNED_FITS`, `NO_TAGS_ON_TARGET`, `NO_CANDIDATES`), and with a collection the buy list is where to send the player
- **Bracket rules and combos (T060):** the "complete a combo" group, `completesOverBracket` on a suggestion, `DeckAnalysis.combos` and `bracketSignals` (placement per T045); credit and link Commander Spellbook wherever combos show
- **Build mode (T063):** the commander and bracket picker that starts a build (T050's picker on `/deck?start=build`, which opens an empty deckbuilder today), the built deck grouped like Add with each card's score and origin, the basics and land target, the feasibility report ("Your collection fills 68 of 99. Card advantage is 9 short") with the value-fill button, its running total and price date, "complete a combo" entries, the build's bracket estimate, and saving the result as a deck
- **Accept rate (T065):** a built deck records as mode `build` once build mode has a screen

**Acceptance criteria:**
- [ ] Each group above has a screen, checked at 390×844 within the swipe budget
- [ ] The deck tool defaults to owned only once the buy list shows (T037)

---

## Data Pipeline

### T043: A database role for the crawl that is not `service_role`

**Priority:** MEDIUM | **Area:** Security / Infrastructure | **Status:** Not started

The VPS container holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS across the whole database, `auth` included, in the same process that serves public read endpoints. The `public.crawl_*` functions narrow what the crawl *does*, not what the key *could* do. Split out of closed T036.

**Files:**
- `services/search-api/internal/config/config.go` — `SupabaseServiceKey`
- `supabase/migrations/20260922000300_deck_crawl_corpus.sql` — the `crawl_*` functions and their grants
- `deploy/README.md`, `roadmap/deck-crawl.md` — the secrets tables

**Acceptance criteria:**
- [ ] A Postgres role granted execute on the `crawl_*` functions and nothing else
- [ ] A JWT minted for that role (Supabase's secret keys all map to `service_role`), placed on the VPS in place of the service-role key
- [ ] `TestLiveStoreRoundTrip` passes with the new role, and a direct table read with it is refused
- [ ] The secrets tables in `deploy/README.md` and `deck-crawl.md` updated

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
- [ ] Verify `commander_requests` are consumed within reasonable time
- [ ] Monitor the `worker_status` heartbeat from the UI

---

### T030: Invalid commander-pair `commander_keys` rows

**Priority:** LOW | **Area:** Data | **Status:** Known issue

Some `commander_keys` rows name two cards that aren't a legal partner pair (Archidekt's Commander category also holds companions and misfiled cards). `resolveDeck` now drops those decks (`isValidPartnerPair`), so the rows survive with no stats attached and render an empty commander page.

**Files:**
- `apps/worker/src/lib/corpus.ts:165` — where `resolveDeck` rejects the pair
- `packages/core/src/formats/commander/validate.ts` — `isValidPartnerPair`
- `apps/worker/src/jobs/aggregate-corpus.ts` — writes `commander_keys`

**Acceptance criteria:**
- [ ] List the keys whose commanders aren't a legal pair and which have no `commander_stats` row
- [ ] Decide: delete them, or mark them so pages and `proxy.ts` treat them as missing
- [ ] Stop `aggregate:corpus` creating new ones
- [ ] Delete only the differing rows, never a table rewrite

---

### T041: Reclaim dead space on hosted

**Priority:** LOW | **Area:** Database | **Status:** Not started

Read 2026-10-07: `printings` is 166 MB on hosted against 56 MB locally (English-only since 2026-09-21 deleted about 425k rows, and daily price updates add more), and `search_index_queue` holds 199 MB with no rows. `commander_card_scores` grew from 799 MB to 1.41 GB when the release rewrote every score once; autovacuum lets Postgres reuse that space but never shrinks the file. Hosted was 4.16 GB of 8 GB after the release.

**Acceptance criteria:**
- [ ] `vacuum full` on `printings` and `search_index_queue` on hosted as superuser (a human, not the read-only role), at a quiet time: it locks the table
- [ ] `commander_card_scores` only if disk gets tight: its `vacuum full` locks the add path while it runs
- [ ] Record the before and after sizes in `status.md`

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
- [ ] Document results in `docs/roadmap/phase0-report.md`

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
- `deck-tool.spec.ts` "a name search's next page continues the list" (seen 2026-10-06) fails without a search index: the first page comes from `search_cards` and a later one (any offset) from `search_cards_filtered`, which rank differently, so cards repeat across pages. The index ranks both the same way.

**Files:**
- `apps/web/e2e/home.spec.ts`, `apps/web/e2e/deck-journey.spec.ts`
- `apps/web/src/components/home/deck-overview.tsx` — the ring's pointer handling

**Acceptance criteria:**
- [ ] `analyzeDeck` waits for either the recommendations or the lookup sheet before dismissing, as the page walk scripts do
- [ ] The ring test hovers a point that is on a slice at the size the ring renders (or asserts through the slice element)
- [ ] A later page of a name search ranks the way the first did when the search index is down
- [ ] Both specs pass locally with `E2E_LOCAL_DATA=1` and in CI (mocks)

---

## Future / Lower Priority

### T049: Re-record the How it works clips

**Priority:** LOW | **Area:** Frontend / Content | **Status:** Not started (owner)

The three How it works recordings (`apps/web/public/add.png`, `cut_gif*.gif`, `swipe_gif*.gif`) show the old slate UI and the old step names (Replace, Review). They sit in a walnut page since the Kitchen Table retheme.

**Acceptance criteria:**
- [ ] Record Cut, Add and Swap in the current look, one clip per step, same pixel size across the three (`StepMedia` in `components/home/how-it-works.tsx`)
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

---

## Closed

One line each, kept so the gaps in the numbering have a reason. Do not reuse these ids; git history has the full write-ups.

- **Shipped without tickets (2026-09-22, contract v11–v16):** deck journey (#84), deck originals (#85), owned first (#86), deckbuilder (#87), collection editing (#92), every search on the index (#96). Follow-ups: T037, T038.
- **T001** Remove local test seed data — closed 2026-09-21: kept for local testing; `seed.sql` refuses to run on any database with other accounts.
- **T004** Privacy policy + account deletion — closed 2026-09-21: `/privacy` and `delete_my_account()` shipped.
- **T005** WotC Fan Content Policy disclaimer — closed 2026-09-21: footer links to the policy.
- **T010** Archidekt always-on crawler — closed 2026-09-28: the daily feed crawl is T036; the per-commander backfill is T035 slice 10.
- **T011** Monitor database growth — closed 2026-09-21: hosted moved to Supabase Pro (8 GB). Leftover vacuum is T041.
- **T012** Parser test fixtures (26 → 60) — closed 2026-09-18: 63 parser tests.
- **T016** Deck export — closed 2026-09-21: copy, text and CSV downloads on deck pages.
- **T019** Admin pages (tag kill switch, sync status) — closed 2026-09-21: `/admin/tags` and `/admin/sync-runs`.
- **T023** `collections.maxEntries` limit review — closed 2026-09-21: 100,000 stays on Pro.
- **T024** Invalidate swap pool cache after corpus rebuilds — closed 2026-09-18: already wired through `TAGS_BY_JOB`.
- **T025** Google sign-in credentials — closed by 2026-09-23: live locally and on hosted.
- **T026** Collection import from a share link — closed 2026-09-21 for Archidekt; ManaBox and TCGplayer publish no link format, and Moxfield needs an account.
- **T036** Deck crawls — closed 2026-09-28: engine and Archidekt source deployed, manual runs wrote 666 decks. Leftovers: daily trigger T042, crawl database role T043, Moxfield T044; aggregating `corpus.decks` is T035 slice 2.
- **T007** Price as a scoring component — closed 2026-10-07: superseded (owner, 2026-10-05). Price ranks the buy list (T059) and the value fill (T063), never the score.
- **T008** Swap pool caching across serverless instances — closed 2026-10-07: the per-request rec functions it would have cached left the request path (T055); adds, cuts and swaps read the precompute tables in one round. The functions themselves leave the database with T067.
- **T020** Deck-internal synergy scoring — closed 2026-10-07: built as T064 (card pairs and deck affinity).
- **T031** Compare our synergy against EDHREC's — closed 2026-10-07: `eval:holdout` reports EDHREC agreement on every run (T058).
- **T035** Deck aggregation pipeline and card graph — closed 2026-10-07: the pipeline shipped as T053–T065 (PR #140). Open pieces: T066, T067, T068.
- **T040** Drop the unused `rec_add_candidates(p_deck_count)` overload — closed 2026-10-07: nothing calls either overload; both go with T067.
- **T042** Make the daily crawl cron produce runs — closed 2026-10-07: a run has started in the cron's hour every day since 2026-10-02. The VPS worker replaces the cron once deployed (T066).
- **T047** Combo detection in the bracket estimate — closed 2026-10-07: built as T060; Spellbook on hosted is T068, the display T045 and T069.
- **T052** Release the deckbuilder redesign — closed 2026-10-07: released 2026-09-30; `cards.mana_cost` filled on hosted and multi-filter search answers `index-filtered`.
- **T053** Data layers — closed 2026-10-07: released 2026-10-05; hosted crawls run on the moved tables.
- **T054** Collator — closed 2026-10-07: released; hosted collated and aggregated 2026-10-06. The first hosted `sync:edhrec` is T068.
- **T055** Precompute worker and the serving request path — closed 2026-10-07: production reads the precompute tables since 2026-10-07; hosted parity matched every gated list. Retired functions: T067.
- **T056** Crawl growth — closed 2026-10-07: 23 commanders past 93 decks (the most 190) and 4,449 declared brackets stored on hosted.
- **T057** Scoring weights into `app_config.scoring` — closed 2026-10-07: released in PR #140; outputs unchanged.
- **T058** Offline evaluation — closed 2026-10-07: released; the gate's open weaknesses are T068.
- **T059** Collection mode — closed 2026-10-07: data, scoring and contract v20 released; its UI is T069.
- **T060** Bracket rules and combos — closed 2026-10-07: released (contract v21); estimator agreement and Spellbook on hosted are T068, the UI T069.
- **T061** EDHREC prior by sample size — closed 2026-10-07: on in production (cap 100); adds recall@20 17.2% → 25.0% on the time split.
- **T062** Learned skeleton — closed 2026-10-07: curve and land counts learned and used by builds; the curve as an add score, curve-based cuts and the EDHREC profile prior failed the gate and ship switched off.
- **T063** Build a deck from a commander and a bracket — closed 2026-10-07: `POST /api/recs/build` live (contract v24); 38.6% overlap with held-out decks. UI is T069.
- **T064** Deck affinity from card pairs — closed 2026-10-07: pairs built on hosted (800,624 per commander, 485,386 corpus-wide); `deck` weighs 0.1 in adds. Latency follow-ups are T068.
- **T065** Live accept rate — closed 2026-10-07: `rec_events` live, written by the server only; build events wait for build mode's screen (T069).
