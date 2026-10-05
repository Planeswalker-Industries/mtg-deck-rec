# Tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up.

> **Keep the four project docs in step.** This file is the queue. [`roadmap/status.md`](roadmap/status.md) is the narrative (current state and why), [`../CLAUDE.md`](../CLAUDE.md) holds repo-wide rules, and [`../apps/web/AGENTS.md`](../apps/web/AGENTS.md) holds web-app detail. Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

Checked against the code on **2026-09-28**. Release and hosted facts updated **2026-09-30**: `main` at PR #118 and `develop` at PR #117, both contract v19, with hosted migrations and the search index caught up. The data layers and scoring tasks (T053–T065) were added **2026-10-05**.

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

Votes are cast (`cast_swap_vote`) and stored in `swap_votes`, but nothing reads them for scoring. `SWAP_WEIGHTS` gives votes 0.1 with a vote-count ramp (`VOTE_HALF_WEIGHT_COUNT`), but `recs.ts` hard-codes `voteCount: 0`, so the component never contributes.

**Files:**
- `apps/web/src/lib/server/votes.ts` — vote reading
- `apps/web/src/lib/server/recs.ts` — recommendation pipeline (the hard-coded `votes` component)
- `packages/core/src/scoring/swap.ts` — `SWAP_WEIGHTS`, the vote ramp
- `packages/core/src/scoring/scoring.test.ts` — existing vote tests

**Context:** The `/rate` rater UI is built. Votes carry `VoteContext` (source, position, candidates shown). The blind swap-quality eval (T014) needs 2 human raters using `/rate`.

**Acceptance criteria:**
- [ ] Read vote counts for (target, replacement) pairs into the swap scoring pipeline
- [ ] Check the existing vote-count ramp against real votes
- [ ] Update existing tests to verify vote influence on rankings
- [ ] Run the swap-quality eval with real raters if possible

**Blocked by:** T014 — weights tuned on no votes are guesses. Collect the eval's votes first, then tune against them.

---

### T007: Price as scoring component ("Collection Fit")

**Priority:** MEDIUM | **Area:** Backend / Contract | **Status:** Reframed 2026-10-05: price ranks the buy list and the value fill, never the score (T059, T063)

**Superseded in part by [`roadmap/scoring-design.md`](roadmap/scoring-design.md).** Owner decision 2026-10-05: price never enters a card's quality score. It ranks collection mode's buy list (T059) and build mode's value fill (T063). The criteria below that add a `price` score component no longer apply; the rest of this ticket is kept for its context.

The recommendation direction is "Collection Fit" — cheaper alternatives are preferred. This changes the contract (`ScoreComponent` union) and requires a version bump.

**Files:**
- `packages/core/src/contract/version.ts` — contract version
- `packages/core/src/contract/recs.ts` — the `ScoreComponent` union
- `packages/core/src/scoring/swap.ts`, `add.ts` — weights
- `apps/web/src/lib/server/recs.ts`, `recs-route.ts` — recommendation pipeline
- `supabase/migrations/` — new migration for price data in rec functions

**Context:** Prices come from Scryfall via the `printings` table. Two things make this bigger than it looks:

1. *It changes the contract.* `ScoreComponent` is a closed union and `ScoreBreakdown.components` is a `Record` over it, so adding `price` needs a version bump (v17 → v18) and updated mocks. The "Why this card" panel renders whatever components exist, so it picks up a price row once it has a label and an absent-reason.
2. *The SQL decides which candidates exist; the blend only decides their order.* `rec_swap_candidates` ends with a hard-coded `order by` mirroring the no-corpus half of `SWAP_WEIGHTS.collection_less`, then `limit p_limit`. A cheap card that scores badly on tag similarity is cut before TypeScript sees it. So either mirror price into that `order by` or widen `p_limit` and pay for it.

**Decided, don't re-litigate:** the collection stays a **hard filter**, not a weighted term (owner decision 2026-09-18). Owned-only removes everything else from the pool; an owned card never outranks a better unowned one. **The shipped "Owned first" mode conflicts with this; see T037.**

**Acceptance criteria:**
- [ ] Design the `ScoreComponent` extension for price delta
- [ ] Bump contract version to v18, update mocks and the changelog comment in `version.ts`
- [ ] Mirror price into `rec_swap_candidates` / `rec_add_candidates` `order by`, or widen `p_limit` — and **repeat `enable_nestloop = off`**, which `create or replace` drops
- [ ] Add a toggle beside "Suggest Game Changers" to turn cost weighting off
- [ ] Zero the price weight while owned-only is on (everything in the pool already costs nothing)
- [ ] Give the "Why this card" panel a label and absent-reason for the price component
- [ ] Update regression harness fixtures

---

### T008: Swap pool caching across serverless instances

**Priority:** HIGH | **Area:** Backend / Performance | **Status:** Closes with T055 (2026-10-05)

**Measured 2026-10-05 on hosted:** calls to `rec_add_candidates` and `rec_swap_candidates` average 0.8–1.0 s and peak at the 3 s `anon` timeout, and `rec_timeouts` gained a swap row on 2026-09-30. T055 replaces both functions with indexed reads of precomputed tables, which removes the query this ticket would cache. Build a cache here only if T055 slips.

`loadSwapPool` doesn't depend on the rest of the deck. It is cached via `use cache` per serverless instance, but cold queries still hit the hosted DB, and the 3 s `anon` timeout used to fire on cold databases. The retry mechanism is a mitigation, not a fix.

**Files:**
- `apps/web/src/lib/server/recs-cache.ts` — `getCachedSwapSuggestions`
- `apps/web/src/lib/server/recs.ts` — `loadSwapPool`, `rankSwaps`
- `apps/web/src/lib/server/retry-timeout.ts` — timeout retry

**Context:** Since the search index went live (2026-09-23), a swap request no longer fetches its candidate card rows from Postgres, leaving `rec_swap_candidates` as the one query. **Read on 2026-09-28:** `rec_timeouts` holds one row, last seen 2026-09-18, so nothing has run out of retries since before the index. Re-read around 2026-09-30; if it is still quiet, this ticket may close without code.

**Acceptance criteria:**
- [ ] Around 2026-09-30, re-read `rec_timeouts` and decide whether caching is still needed
- [ ] If needed: design a caching strategy (a precomputed pool per target in Postgres, Redis, or a longer `use cache` TTL) and implement it
- [ ] Verify cold-query timeouts stay out of `rec_timeouts`

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
- [ ] Confirm the daily sync drains the queue. Until 2026-09-30 every drain failed with the proxy's `404 page not found`: the service's generated domain had changed, and only Vercel had the new one. The GitHub secret and `.env.hosted` are fixed, and a hand drain and a rebuild worked that day; the next daily run is the proof.
- [ ] `scripts/search-parity-check.ts` passes against hosted data (`commanders` and `commander_cards` have never been exercised with real rows)
- [ ] Measure RAM after the first build (`/metrics.json`) and record it in the runbook
- [ ] Around 2026-09-30, re-read `rec_timeouts` and update T008

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

First part of the deck analysis work (T046–T048), and it comes first: decide where and how the new numbers are shown before building any of them. Came out of a look at EDHcheck (edhcheck.com, 2026-09-28) with the sample Liesa deck. Its functions are solid (mana simulation, per-card cast rates, combo detection, bracket explorer), but the page is a wall of panels, invented composite scores and upsells. We want the useful numbers, shown only where they change what the player does next.

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
- [ ] A concept (screens or a POC per `docs/ui_concepts/`) for phone and desktop covering T046–T048
- [ ] Owner sign-off on placement and on what is left out
- [ ] T046–T048 updated with the agreed placement

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

### T047: Combo detection in the bracket estimate

**Priority:** MEDIUM | **Area:** Data / Core | **Status:** Data half built (PR #127, reworked 2026-10-05 into the raw `spellbook` schema); detection continues as T060

**Blocked by:** T045 (display). **Continues as T060** ([`roadmap/scoring-design.md`](roadmap/scoring-design.md), "Bracket rules"), which takes over the criteria below.

`estimateBracket` (`packages/core/src/formats/commander/bracket.ts`) reads only Game Changer count and mass land denial. WotC's brackets also limit two-card infinite combos (none in 1–2, none early in 3) and chained extra turns, so a deck with a combo and no Game Changers is estimated too low today. WotC removed tutor limits from every bracket in October 2025; the strongest tutors are Game Changers. Commander Spellbook's combos are loaded raw by `sync:spellbook` (CLAUDE.md, "Combos"); what is left is flagging the combos a deck contains.

**Files:**
- `packages/core/src/formats/commander/bracket.ts`, `commander.test.ts`: `BracketSignals`, `estimateBracket`
- `packages/core/src/journey/`: `bracketMustCuts` would learn to cut a combo piece
- `apps/worker/src/jobs/sync-spellbook.ts`, `supabase/migrations/20261005000400_spellbook.sql`: the raw data (`spellbook.combos`, `spellbook.features`)

**Context:**
- **Source check done (2026-10-04):** robots.txt allows the site and disallows the API host; the daily export is the only thing fetched. Recorded in CLAUDE.md's source list.
- Combos are stored raw in Spellbook's terms (oracle ids, its feature ids, its bracket tag); the collator resolves them to our `CardId`s (T054) and the precompute worker indexes them by card (`spellbook_combo_pieces`, T055). Only two-card combos matter for the bracket rules; longer ones may still be worth showing.
- Showing combos means crediting and linking Commander Spellbook, and never showing `edhrec_deck_count` (EDHREC's numbers).
- "Early game" in bracket 3: answered 2026-10-05. Spellbook's R tag alone marks a combo as too early for bracket 3; no mana value rule.
- Extra turns and mass land denial: answered 2026-10-05. Tagger's `extra-turn` and `mass-land-denial` tags count, planeswalkers excluded (their effect is an ultimate), with the tag UUIDs in `app_config.brackets`. Brackets 2–3 allow at most 2 extra-turn cards, never looped.

**Acceptance criteria:**
- [x] Source check recorded (robots.txt, bulk export; no published terms)
- [x] Sync job and raw tables, with SQL checks under `supabase/tests/` (`spellbook.sql`)
- [ ] `sync:spellbook` on hosted: once migration `20261005000400` is on hosted, set the repo variable `SPELLBOOK_SYNC_ENABLED` to `true` (or run `cli:hosted sync:spellbook` once)
- [ ] `BracketSignals` gains combos and extra turns; tests
- [ ] `DeckAnalysis` names the combos found (contract version bump) and the display follows T045
- [ ] `bracketMustCuts` handles combos when the chosen bracket forbids them

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
- [ ] Tests for the counting, which mirrors `rec_card_roles`

---

### T052: Release the deckbuilder redesign (contract v18–v19)

**Priority:** HIGH | **Area:** Deploy | **Status:** Released to `main` 2026-09-30 (#117 via #118); `mana_cost` fill and the header check open

The deckbuilder's multi-select filters, legendary, A–Z sort, owned-only search and decklist rows with cost symbols span every layer, so the release has an order. Until each step lands the app still answers (the index read fails and Postgres takes over), just slower.

**Files:**
- `supabase/migrations/20260929000100_search_cards_filtered_multi.sql`, `20260929000200_cards_mana_cost.sql`, `20260929000300_search_cards_filtered_v19.sql`, `20260929000400_search_loose_names.sql`
- `services/search-api/internal/api/read.go` — `type` and `mv` lists, `sort`, legendary
- `packages/core/src/search/documents.ts` — new `card_types` and `mana_cost` fields, `token_separators` on the cards collection

**Acceptance criteria:**
- [ ] Contract v18 and v19 approved by frontend and backend (PR)
- [x] Migrations applied on hosted (2026-09-30, by `supabase db push`: the Supabase GitHub integration had come unlinked, so nothing after `20260922000400` had been applied through it)
- [ ] `sync:catalog` run on hosted after the migration, so `cards.mana_cost` is filled (it rewrites every card once). Left to the daily sync, which runs it once Scryfall's file changes
- [x] Search API redeployed on the VPS, then `sync:typesense --rebuild` (`search-index.yml`, 2026-09-30; card documents carry `card_types`)
- [ ] `x-search-source: index-filtered` on a deckbuilder search with two types and two costs

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

**Priority:** LOW | **Area:** Scoring | **Status:** Ruled 2026-10-05: owned only plus a buy list becomes the default (T059)

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

One pipeline in layers, then one scoring engine on top. The pipeline (raw source schemas, the collator, the precompute worker) is [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md); the scoring (formulas, the one marginal-value function, the three modes, bracket rules, the evaluation gate) is [`roadmap/scoring-design.md`](roadmap/scoring-design.md). Owner decisions of 2026-10-04/05 are recorded in both. The order is the roadmap in `scoring-design.md`: T053, T054, T055, T057, T058, T061, T059, T060, T062, T064, T063, with T056 and T065 at any time. T066 (the VPS worker) runs the pipeline's jobs on a schedule once T054 is out.

### T053: Data layers: schemas and table moves

**Priority:** HIGH | **Area:** Database | **Status:** Built 2026-10-05: migration `20261005000200_data_layers.sql` (PR #129, on `develop`) and PR #127's `spellbook` tables (`20261005000400_spellbook.sql`); waiting for release

Each source's data moves into its own schema, as the source published it (`archidekt.decks` back to oracle ids, empty `edhrec.*` raw tables). The crawler's machinery moves to `crawl`, and `corpus` becomes the collated layer: today's EDHREC tables move in as `corpus.edhrec_commanders` and `corpus.edhrec_commander_cards`, and a new collated `corpus.decks` starts empty. PR #127 is reworked to create `spellbook.combos` and `spellbook.features` (with `edhrec_deck_count` in place of `popularity`) instead of `public.combos`, and its command becomes `sync:spellbook` (from `sync:combos`). The step list is "The reorg migration" in the plan.

**Files:** `supabase/migrations/20261005000200_data_layers.sql`, `20261005000400_spellbook.sql`; `supabase/tests/crawl-commanders.sql`, `admin-crawled-decks.sql`, `edhrec-stats.sql` (was `external-stats.sql`), `edhrec-prior.sql`, `data-layers.sql`, `spellbook.sql`; `CLAUDE.md` (data pipeline); `roadmap/deck-crawl.md`

**Acceptance criteria:**
- [x] Hosted migration history repaired before the migration ships (2026-10-05)
- [x] Schemas and moves as the plan lists; only the crawled decks are rewritten, with a check that nothing is lost
- [x] The 13 `crawl_*` functions keep their names and arguments, and the Go service needs no change (only comments and one log line moved); the live store test passes against local PostgREST
- [ ] A hosted crawl run succeeds after release
- [x] The EDHREC prior (renamed `edhrec_card_priors`) and the `/admin/crawls` functions read the moved tables; every SQL check passes
- [x] The deck spike's code is retired: `spike:archidekt:*`, `spike:corpus:stability`, `spike:edhrec:prior`, `profile:tags`, `serve:commander-requests`, `import:edhrec` and the TypeScript Archidekt client. `aggregate:corpus` reads the collated `corpus.decks` and never writes from an empty one
- [x] Tables, columns and functions that hold one source's data say which source (`corpus.edhrec_commanders`, `corpus.edhrec_commander_cards`, `crawl.queue.edhrec_deck_count`, `edhrec_card_priors`); `data-layers.sql` checks the rule
- [x] PR #127's tables live in `spellbook`, raw: oracle ids and Spellbook's own values, no catalog lookups (2026-10-05)

---

### T054: Collator

**Priority:** HIGH | **Area:** Worker / Data | **Status:** Built 2026-10-05 (`cli collate`, `sync:edhrec`, migrations `20261005000500`–`600`); waiting for release, after PR #127 | **Blocked by:** T053

`cli collate` resolves raw rows into `corpus` for every source (Archidekt and Moxfield decks, players' saved decks, EDHREC pages, Spellbook combos) with one deck rule (`checkCorpusDeck`, `@mtg/core/commander`), only where something changed, each source in its own transaction with its progress in `corpus.collate_state`. `sync:edhrec` (from PR #128, rewritten for raw) fetches EDHREC's pages into `edhrec.*` as the `edhrec_pages` job. CLAUDE.md ("Data layers", "Deck corpus and play rates") has the rules. PR #128's VPS worker and review fixes moved to T066.

**Files:** `apps/worker/src/jobs/collate.ts`, `sync-edhrec.ts`; `packages/core/src/formats/commander/corpus.ts`; `supabase/migrations/20261005000500_sync_job_collate.sql`, `20261005000600_collator.sql`; `supabase/tests/collator.sql`

**Measured locally (2026-10-05)**, with hosted's 76,774 crawled decks copied in: 18 s to collate them all, 74,874 pass the rule (exclusions: 654 invalid partner pairs, 473 commanders not legal, 396 with no eligible commander, 252 with three or more commanders, 123 outside the colours, 2 others); `aggregate:corpus` over the result took 1 min 38 s for 2,716 commanders and 1.54M commander-card rows. A 30-page `sync:edhrec` trial resolved every listed card and the same commanders as the 2026-09-28 import, and a re-fetch wrote nothing.

**Acceptance criteria:**
- [x] `corpus.decks` holds every raw deck that passes the rule; exclusions counted by reason
- [x] EDHREC pages and Spellbook combos collated; `listed_floor` computed
- [x] Players' decks only when complete (the corpus rule, public or private); a deleted deck or account leaves the corpus; the visibility copy and `/privacy` say so
- [x] `sync_runs` job `corpus_collate` with a sanity gate per source; a source with no finished fetch is never collated
- [ ] On hosted, after release: `cli:hosted sync:edhrec` (about 3.5 h), then `collate`, then `aggregate:corpus`; check each run in `/admin` (sync runs)

---

### T055: Precompute worker and the serving request path

**Priority:** HIGH | **Area:** Worker / Backend | **Status:** Designed 2026-10-05; its inputs are ready (T054: `corpus.dirty_commanders` fills on every corpus write, `corpus.spellbook_combos` is collated) | **Blocked by:** T054

The serving tables (`commander_card_scores`, `card_substitutes`, `card_roles`, `spellbook_combo_pieces`, and per-dirty-commander `commander_stats`) are built by the precompute worker, and the add, cut and swap paths become indexed reads with scoring in `@mtg/core`. `rec_add_candidates`, `rec_swap_candidates`, `retry-timeout.ts` and `rec_timeouts` retire. On hosted, calls to the two functions average 0.8–1.0 s and peak at the 3 s timeout (2026-10-05).

**Acceptance criteria:**
- [ ] Parity: the same add and swap lists as before the switch (regression fixtures plus a parity script)
- [ ] p95 add and swap latency on hosted recorded before and after
- [ ] Diff-only writes, sanity gates, and a schedule in `app_config.worker`
- [ ] T008 closed; T040 closed as moot

---

### T066: VPS worker

**Priority:** HIGH | **Area:** Worker / Ops | **Status:** Not started (PR #128's worker, to be carried over) | **Blocked by:** T054

The worker container on the VPS (`deploy/worker/`, `deploy/dokploy/worker.yml`) runs the jobs that run by hand today, on a schedule in `app_config.worker`: `collate` after every fetch, `aggregate:corpus` when the corpus changed, `sync:edhrec` weekly, and the daily crawl trigger (T042). Deck lookups (T009) go through the crawl: a requested commander jumps the crawl queue, and the worker starts a crawl run at once when the claim is free, so there is one Archidekt client with one politeness and kill-switch implementation.

**Carry over from PR #128, with its review fixes:** the container and deploy files, `cli serve`; a lookup's rebuild keeps the sanity gate; lookups honour Archidekt's kill switch and 403s (by going through the crawl); the crawl-token fallback works with empty variables; the claim is released on shutdown.

**Acceptance criteria:**
- [ ] The worker deployed on the VPS with `DATABASE_URL` (session pooler), the search API tokens, `WEB_APP_URL` and `REVALIDATE_SECRET`
- [ ] Schedule in `app_config.worker`; `worker_status` heartbeat shown to the deck tool
- [ ] Deck lookups served through the crawl queue (closes T009)
- [ ] Two days of worker-triggered crawls, then the Vercel cron goes (T042)

---

### T056: Crawl growth

**Priority:** MEDIUM | **Area:** Search API (Go) | **Status:** Owner rule 2026-10-05

A revisit re-reads page 1, then reads on until `revisitNewDecks` (25) decks were new or changed, or the list ends. `maxPagesPerCommander` and `maxFetchesPerCommander` stay as ceilings. It replaces `revisitPages` (page 1 only, 2026-10-03), under which no commander passed 93 decks. The adapter also records each deck's declared bracket in `archidekt.decks.declared_bracket` (needs T053). Rule in [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md), "Crawl".

**Files:** `services/search-api/internal/crawl/policy.go`, `run.go`, `internal/archidekt/`; a migration for `app_config.archidekt`; `roadmap/deck-crawl.md`

**Acceptance criteria:**
- [ ] Policy and tests; `app_config.archidekt.revisitNewDecks` = 25
- [ ] A week of hosted runs shows commanders past 93 decks
- [ ] `declared_bracket` filled for new fetches

---

### T057: Scoring weights into `app_config.scoring`

**Priority:** HIGH | **Area:** Backend / Scoring | **Status:** Not started

Move `ADD_WEIGHTS`, `SWAP_WEIGHTS` and the cut thresholds (`packages/core/src/scoring/`) into `app_config.scoring`, read by TypeScript. While `rec_swap_candidates` still exists it reads the same row instead of mirroring the weights (repeat `enable_nestloop = off`).

**Acceptance criteria:**
- [ ] Weights read from `app_config.scoring`; no scoring constant left in code
- [ ] Regression fixtures unchanged

---

### T058: Offline evaluation

**Priority:** HIGH | **Area:** Data / Scoring | **Status:** Not started | **Blocked by:** T054, T057

`cli eval:holdout` over the collated `corpus.decks`: a 90/10 split by deck with a fixed seed (`app_config.scoring.evalSeed`), a time split for anything EDHREC touches, size buckets of 50 and up, 10–49 and under 10 decks, and the tests and bootstrap gate in [`roadmap/scoring-design.md`](roadmap/scoring-design.md), "Evaluation".

**Acceptance criteria:**
- [ ] Baseline report for today's scoring
- [ ] The gate is scripted: recall@20 up with a 95% bootstrap interval above zero (1,000 resamples over commanders), no bucket down by more than its half-width, Sol Ring rate within `solRingTolerance`, fixtures pass

---

### T059: Collection mode: availability, conflicts and the buy list

**Priority:** HIGH | **Area:** Full stack / Contract | **Status:** Not started | **Blocked by:** T055, T057

The priority mode. Owned only plus a separate "worth buying" list becomes the default (owner decision 2026-10-05, closes T037, reframes T007). Recommendations get quantities; an owned functional twin stands in for a card; `decks.is_built` marks decks that hold their cards, and cards in them are conflicts the player can swap out there. Every owned card in the identity is scored, which is lookups once T055 lands.

**Acceptance criteria:**
- [ ] `available()` per the design (quantities, twins, built decks, basics), tested in `@mtg/core`
- [ ] `decks.is_built` migration, SQL checks, and a control on the deck page
- [ ] Contract bump: `conflict`, `buyList`, quantities in `OwnershipInput`, `'only'` default
- [ ] The evaluation's collection-mode recall recorded

---

### T060: Bracket rules and combos

**Priority:** HIGH | **Area:** Core / Data / Contract | **Status:** Not started | **Blocked by:** T054 (combos collated), T055; display per T045

`estimateBracket` gains two-card combos (Spellbook's tag as a minimum bracket), mass land denial and chained extra turns, with tag UUIDs and limits in a new `app_config.brackets`. Game Changers and mass land denial are hard limits; combos and extra turns are flagged with a cut offered (`OVER_BRACKET_COMBO`, `OVER_BRACKET_EXTRA_TURNS`). No tutor limit (WotC, October 2025). Add results gain the "complete a combo" group, credited and linked to Spellbook. Continues T047.

**Acceptance criteria:**
- [ ] `app_config.brackets` with the owner's answers (2026-10-05): R combos flag in bracket 3; `mass-land-denial` and `extra-turn` tag UUIDs, planeswalkers excluded; `maxExtraTurnCards` 0 in bracket 1 and 2 in brackets 2–3
- [ ] `BracketSignals`, cut reasons and the combo group, tested; `DeckAnalysis.combos` (contract bump), credited and linked
- [ ] Estimator agreement with declared brackets reported (a check only)

---

### T061: EDHREC prior by sample size

**Priority:** MEDIUM | **Area:** Scoring | **Status:** Not started | **Blocked by:** T055, T058

Replace `externalPriorShare` with `edhrecPriorCap` and the sample-size update in [`roadmap/scoring-design.md`](roadmap/scoring-design.md) ("`corpus`"): shrink toward EDHREC's rate with a strength of its deck count up to `externalPriorCap`, toward `min(p0, floor)` for cards a page doesn't list, and toward p0 without a page. The cap starts at 200 and is set by the evaluation.

**Acceptance criteria:**
- [ ] The formula in `@mtg/core/scoring` and the precompute worker, tested
- [ ] The 10–49 and under-10 buckets rise; none falls

---

### T062: Learned skeleton: curve and land profiles

**Priority:** MEDIUM | **Area:** Data / Scoring | **Status:** Not started | **Blocked by:** T055, T058

`commander_stats` gains `curve_profile`, `land_count` and `basic_land_count` (learned per commander, so builds need no fixed minimum of basics); EDHREC supplies role and curve priors for thin commanders; the `curve` component joins adds and cuts, and its cut signal replaces the fixed "mana value 6 or more" rule.

**Acceptance criteria:**
- [ ] Profiles written per dirty commander, diff-only
- [ ] `curve` passes the evaluation gate before it gets weight

---

### T063: Build a deck from a commander and a bracket

**Priority:** MEDIUM | **Area:** Full stack / Contract | **Status:** Not started | **Blocked by:** T059, T060, T062

`BuildApi.build`: learned skeleton, greedy fill by the marginal-value function from available cards, lands by pip share, a feasibility report when the collection falls short, and an optional best-value fill with a running price total. A pure function in `@mtg/core`; the entry point is T050's picker.

**Acceptance criteria:**
- [ ] Deterministic builds that never break a hard limit; tests
- [ ] Build overlap and role and land error in the evaluation report
- [ ] Contract bump and UI (picker, feasibility report, value fill)

---

### T064: Deck affinity from card pairs

**Priority:** MEDIUM | **Area:** Data / Scoring | **Status:** Not started | **Blocked by:** T055, T058

Pair tables (`commander_card_pairs`, `card_pairs`) from the precompute worker, the `deck` component in adds, cuts, swaps and builds, `LOW_AFFINITY`, and the contract's `deck` component. Check the VPS has room for the weekly global recount (about 450 MB) beside Typesense first.

**Acceptance criteria:**
- [ ] Row counts within the plan's estimates
- [ ] Recall@20 beats the T058 baseline; p95 add latency not worse on hosted

---

### T065: Live accept rate

**Priority:** LOW | **Area:** Full stack | **Status:** Not started

`rec_events`: one row per shown batch and per accept or decline, keyed by account or salted visitor hash like `swap_votes`, written through a rate-limited security-definer function, no API reads. `/privacy` gains a line. Can start at any time.

**Acceptance criteria:**
- [ ] Events recorded for add, cut, swap and build; admins see accept rate per mode and rank
- [ ] `/privacy` updated (owner, 2026-10-05: a line explaining it, no opt-out, the same as swap votes)

---

## Data Pipeline

### T035: Deck aggregation pipeline and card graph

**Priority:** HIGH | **Area:** Backend / Data | **Status:** Unshelved by the owner 2026-10-05; continues as T053–T066. Slice 11 merged (PR #111, 2026-09-28)

The design is [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md), revised 2026-10-05, with the scoring in [`roadmap/scoring-design.md`](roadmap/scoring-design.md). Every source keeps its data in its own schema, as published. A collator resolves it into `corpus`, where every row names its source. A precompute worker builds everything the app reads, so a request is indexed reads plus small per-deck sums. Complete user decks become a source, aggregation recomputes only the commanders whose decks changed, sparse card-pair tables feed a "deck affinity" score, EDHREC commander pages serve as a prior and a benchmark, and every commander is crawled.

**Slice 11 (EDHREC statistics) is on `main`** (PR #111, released in PR #118).
- **Fetching.** A one-off local script fetched every commander page from `json.edhrec.com` (2026-09-28). `sync:edhrec` (PR #128) replaces it with a weekly job on the VPS worker, writing the raw `edhrec` schema once T053 lands.
- **Loading.** `import:edhrec` (retired 2026-10-05 with the stale saved pages it read) wrote the pages into `external_commanders` and `external_commander_card_stats` (now `corpus.edhrec_commanders` and `corpus.edhrec_commander_cards`) (migration `20260928000200_external_commander_stats.sql`). Loaded locally on 2026-09-28 and on hosted on 2026-09-30 (6,787 commanders, 1,791,474 card rows).
- **Evaluation.** `spike:edhrec:prior` (retired 2026-10-05; T058 repeats it with a time split) was a holdout test. EDHREC beat the colour baseline as a prior at every deck count measured. `supabase/tests/edhrec-stats.sql` holds the SQL checks.
- **Wired, switched off:** `edhrec_card_priors` (added as `external_card_priors` in migration `20261002000100`, PR #123; renamed by T053) feeds the prior with `app_config.corpus.externalPriorShare` at 0. T061 replaces the share with weighting by sample size.

**Slice 10 (full-suite crawl) is built** in the Go search API, not the TS worker the plan names: a commander queue seeded from EDHREC, decks most viewed first, one page per commander on the first visit. Revisits re-read page 1 only (2026-10-03), so samples grow only from churn; T056 restores growth (25 new or changed decks per revisit, owner rule 2026-10-05). Deck lookups move to the VPS worker in PR #128 (T009). It absorbs closed ticket T010.

**Owner decisions it rests on:**
- 2026-09-21: user decks count only when complete (100 cards and legal); all data lives in Postgres, under the legal team's consent to all publicly facing data (the crawler guardrails still apply); collections stay one per account; win-condition analysis waits.
- 2026-10-05: data layers, a collator and a precompute worker; the deck spike's files are stale and are not imported; `minDecks` and `fullDecks` are both 50. Listed in [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md).

**Supersedes:** T020 (by T064), T031 (T058's EDHREC agreement automates it).

**Acceptance criteria:**
- [x] The owner reviews the plan and sets the order (2026-10-05: [`roadmap/scoring-design.md`](roadmap/scoring-design.md), "Roadmap")
- [ ] T053–T066
- [x] Slice 11: EDHREC statistics loaded, and the holdout test shows the prior helps commanders with few decks
- [x] Slice 11 follow-up: release to `main` and load hosted (2026-09-30)
- [x] Slice 11 follow-up: wire the prior into scoring (switched off, PR #123); T061 turns it on

---

### T042: Make the daily crawl cron produce runs

**Priority:** MEDIUM | **Area:** DevOps / Data | **Status:** Not started

The deck crawl (closed T036) works when started by hand, but the daily Vercel cron has never produced a run. `vercel.json` schedules `/api/cron/archidekt-scrape` for 10:15 UTC, and a Hobby-plan cron fires somewhere within that hour. That route POSTs `/cron/archidekt/scrape` on the search API, which starts the crawl. Full runbook: [`roadmap/deck-crawl.md`](roadmap/deck-crawl.md).

**Files:**
- `apps/web/vercel.json` — the cron schedule
- `apps/web/src/app/api/cron/` — the scrape routes (`CRON_SECRET`, pass-through of the search API's 502)
- `services/search-api/internal/crawl/` — `Runner.Preflight`, the claim

**Context:** Hosted `corpus.crawl_runs`, read 2026-09-28 after that day's cron hour, holds three Archidekt runs: 2026-09-24 03:32 (failed on a deleted deck, fixed in #105), 2026-09-24 14:16 and 2026-09-27 21:30. None started in the cron's hour. Either the trigger never reaches the search API, or something refuses it before a run starts. A fourth run, 2026-09-30 13:12 UTC, succeeded, and it too started outside the cron's hour. Read again 2026-10-03: runs 6 and 7 started at 10:45 UTC on 2026-10-02 and 2026-10-03, both in the cron's hour, which meets the last criterion. Run 7 failed after starting, on an empty deck response (`deck response changed shape: no card entries`), not on the trigger; empty decks are now skipped as unqualified.

**Acceptance criteria:**
- [ ] Read the Vercel cron log for `/api/cron/archidekt-scrape`: 401, 502, 503, or not firing
- [ ] Check `CRON_SECRET`, `SEARCH_API_URL` and `SEARCH_API_CRON_TOKEN` on Vercel Production, and `SEARCH_API_CRON_TOKEN` on the VPS
- [ ] A run in `corpus.crawl_runs` starts in the cron's hour on two consecutive days

---

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

**Priority:** MEDIUM | **Area:** Backend / Worker | **Status:** PC worker retired 2026-10-05; served through the crawl queue by the VPS worker (T066)

Deck lookups queue in `commander_requests`, and nothing consumes them. The worker that did, `serve:commander-requests`, ran by hand from the owner's PC and wrote decks into the old deck spike's file; it had been offline since 2026-09-16 and was retired on 2026-10-05 with the rest of the spike code. T066 serves lookups through the crawl: a requested commander goes to the front of the crawl's queue, and the VPS worker starts a crawl run when the claim is free.

**Files:**
- T066's worker (`apps/worker/src/jobs/serve.ts` in PR #128)
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

### T040: Drop the unused `rec_add_candidates(p_deck_count)` overload

**Priority:** LOW | **Area:** Database | **Status:** Moot once T055 retires `rec_add_candidates`; do it only if T055 slips

`rec_add_candidates` has two overloads. The app calls only the one taking `p_key_weights`; the older `p_deck_count` one was kept "until deployed apps stop calling it", and none does.

**Acceptance criteria:**
- [ ] Confirm no caller: app code, worker, `pg_stat_statements` on hosted
- [ ] A migration drops the `p_deck_count` overload (the hosted `claude_readonly` role has EXECUTE on `rec_add_candidates`; check that grant still covers the remaining overload)
- [ ] Regenerate `database.types.ts`

---

### T041: Reclaim `printings` space on hosted

**Priority:** LOW | **Area:** Database | **Status:** Not started

Printings became English-only on 2026-09-21 (`20260921000200_english_printings_only.sql`), deleting about 425k rows. Hosted has not had `vacuum full public.printings;` since, so roughly 120 MB of dead space remains. Not urgent on Pro's 8 GB; tidier and faster scans once done.

**Acceptance criteria:**
- [ ] Run `vacuum full public.printings;` on hosted as superuser (a human, not the read-only role), at a quiet time: it locks the table
- [ ] Record the before and after size in `status.md`

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

**Files:**
- `apps/web/e2e/home.spec.ts`, `apps/web/e2e/deck-journey.spec.ts`
- `apps/web/src/components/home/deck-overview.tsx` — the ring's pointer handling

**Acceptance criteria:**
- [ ] `analyzeDeck` waits for either the recommendations or the lookup sheet before dismissing, as the page walk scripts do
- [ ] The ring test hovers a point that is on a slice at the size the ring renders (or asserts through the slice element)
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

### T020: Deck-internal synergy scoring

**Priority:** LOW | **Area:** Backend / Scoring | **Status:** Superseded by T064

Score cards by how they connect to the rest of the deck. T064's card-pair tables and deck affinity score are the planned design; this ticket stays only until that starts.

---

### T021: Retune partnerPoolWeight

**Priority:** LOW | **Area:** Scoring | **Status:** Not started

`partnerPoolWeight` 0.25 was calibrated on only 4 commander pairs (all including Rograkh). Retune when more pair data exists.

**Files:**
- `packages/core/src/scoring/corpus.ts` — `partnerPoolWeight`
- `apps/web/src/lib/server/corpus.ts` — default settings

**Acceptance criteria:**
- [ ] Re-run corpus stability with more partner pair data
- [ ] Adjust `partnerPoolWeight` if partner pair coverage improves
- [ ] Update `app_config.corpus` in database

---

### T031: Compare our synergy against EDHREC's

**Priority:** LOW | **Area:** Data / Quality | **Status:** Unblocked 2026-09-21; data loaded locally 2026-09-28; comparison not written up

`commander_card_stats.synergy` is shrunk inclusion − baseline p0, the same formula EDHREC documents, from our own corpus and with shrinkage they don't appear to apply. Comparing a handful of commanders against their published numbers is a cheap sanity check on our corpus — a comparison, never a source of truth.

**Context:** EDHREC is now an allowed source.
- **Consent.** On 2026-09-21 the owner's legal team consented to using all publicly facing data, EDHREC included. `CLAUDE.md`'s Hard constraints record this, and the crawler guardrails still apply.
- **The data is loaded.** T035 slice 11 put EDHREC's per-commander numbers in `corpus.edhrec_commander_cards`, including its published `synergy`, so this is now a query rather than a manual read of web pages.
- **What exists so far.** The retired `spike:edhrec:prior` compared inclusion estimates, not synergy; a first look at Liesa's top ten synergy cards agreed within a few points.
- **Later.** T035 automates this as a per-commander benchmark in the offline evaluation (slice 6). This ticket is the one-off check until then.

**Acceptance criteria:**
- [ ] Pick ~5 commanders with the most decks in our corpus
- [ ] Compare their top synergy cards against EDHREC's from `corpus.edhrec_commander_cards` (joined on `(commander_1, coalesce(commander_2, 0))`)
- [ ] Write up where we disagree and whether it looks like corpus size, shrinkage, EDHREC trimming its lists near 5% of decks, or a bug

---

## Technical Debt

### T022: Play rate amplifying weak tag matches

**Priority:** LOW | **Area:** Scoring | **Status:** Known issue

Reliquary Tower tops Sea Gate Restoration swaps at 51% play rate despite a 0.65 tag score. Play rate can lift weak tag matches above stronger ones.

**Files:**
- `packages/core/src/scoring/swap.ts` — swap scoring weights
- `packages/core/src/scoring/corpus.ts` — corpus component

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
