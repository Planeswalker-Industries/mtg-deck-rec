# Tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up.

> **Keep the four project docs in step.** This file is the queue. [`roadmap/status.md`](roadmap/status.md) is the narrative (current state and why), [`../CLAUDE.md`](../CLAUDE.md) holds repo-wide rules, and [`../apps/web/AGENTS.md`](../apps/web/AGENTS.md) holds web-app detail. Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

Checked against the code on **2026-09-28**: `develop` at PR #111 (contract v17), `main` at PR #109 (contract v16). Hosted facts were read with the read-only role on the same day.

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

**Priority:** MEDIUM | **Area:** Backend / Contract | **Status:** Decided, not built

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

**Priority:** HIGH | **Area:** Backend / Performance | **Status:** Waiting on the 2026-09-30 measurement

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
- [ ] Confirm the daily sync drains the queue
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

Supabase's built-in SMTP sends only a couple of emails an hour and is not for production, so the email-code sign-in path cannot be relied on. Google sign-in covers the owner meanwhile. Moxfield's bot whitelist also wants a production domain (T036).

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

**Priority:** LOW | **Area:** Scoring | **Status:** Blocked on an owner ruling

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
- [ ] Owner rules on the conflict with T007's 2026-09-18 decision; the ruling is recorded in `status.md` and T007
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

## Data Pipeline

### T035: Deck aggregation pipeline and card graph

**Priority:** HIGH | **Area:** Backend / Data | **Status:** Slices 1–10 shelved 2026-09-21, waiting for a backend owner; slice 11 merged to `develop` (PR #111, 2026-09-28)

The full design is [`roadmap/card-graph-plan.md`](roadmap/card-graph-plan.md). The corpus moves from JSONL on X: into Postgres. Complete user decks become a source. Aggregation recomputes only the commanders whose decks changed. Sparse card-pair tables feed a new "deck affinity" score, EDHREC commander pages serve as a prior and a benchmark, and every commander is crawled rather than the top 50. It is split into 11 slices, each one PR.

**Slice 11 (EDHREC statistics) is on `develop`** (PR #111), not yet on `main`. It was started ahead of the rest because the plan lets slices 10 and 11 run on their own tables.
- **Fetching.** `X:\mtg_proj\tools\edhrec-crawl.mjs` saves every commander page from `json.edhrec.com`. It is a local script, not the `sources/edhrec/` worker adapter the plan names.
- **Loading.** `import:edhrec` writes the saved pages into `external_commanders` and `external_commander_card_stats` (migration `20260928000200_external_commander_stats.sql`). Loaded locally on 2026-09-28; the tables do not exist on hosted yet.
- **Evaluation.** `spike:edhrec:prior` is a holdout test. EDHREC beat the colour baseline as a prior at every deck count measured, so the slice's gate is passed. `supabase/tests/external-stats.sql` holds the SQL checks.
- **Not done:** no code reads the tables. Wiring the prior into `corpusComponent` and `rec_add_candidates` is the next step, and so is the per-commander benchmark in the offline evaluation, which needs slice 6.

**Slice 10 (full-suite crawl) builds on T036.** T036's daily crawl walks Archidekt's update-ordered feed. Slice 10 adds the per-commander backfill that reaches every commander with enough decks (~2,800), and moves `serve:commander-requests` (T009) off this PC. It absorbs closed ticket T010.

**Owner decisions it rests on (2026-09-21):**
- User decks count only when complete: 100 cards and legal. `save_deck` today flags on per-card legality alone.
- All data lives in Postgres. The legal team consented to using all publicly facing data, EDHREC and MTGGoldfish included. The crawler guardrails (robots.txt, honest User-Agent, stop on a block) still apply.
- Collections stay one per account, and win-condition analysis waits.

**Supersedes when started:** T020 (slices 5–8), T031 (slice 11's benchmark automates it).

**Acceptance criteria:**
- [ ] A backend owner reviews the plan and confirms or changes the slice order
- [ ] Slices 1–10 as listed in the plan
- [x] Slice 11: EDHREC statistics loaded, and the holdout test shows the prior helps commanders with few decks
- [ ] Slice 11 follow-up: release to `main`, load hosted (`cli:hosted import:edhrec`), and wire the prior into scoring

---

### T036: Deck crawls — Archidekt active, Moxfield blocked

**Priority:** MEDIUM | **Area:** Backend / Data | **Status:** Deployed; manual runs write decks, the daily cron does not produce runs

A shared crawl engine and two sources behind a daily Vercel cron: `vercel.json` → `/api/cron/{moxfield,archidekt}-scrape` (authorized by `CRON_SECRET`) → `POST /cron/:source/scrape` on the search API, which crawls in the background and writes decklists into the private `corpus` schema through the `public.crawl_*` functions. On `main` since the 2026-09-22 release (#97), with fixes in #104–#107. Full account and runbook: [`roadmap/deck-crawl.md`](roadmap/deck-crawl.md); the rules are in `CLAUDE.md` ("Deck crawls").
- `services/search-api/internal/crawl/` — the engine: policy, fetcher, run loop, store.
- `services/search-api/internal/archidekt/` — **active**; parsers pinned against live fixtures; 3 s pace because 1 s drew 429s.
- `services/search-api/internal/moxfield/` — built, **blocked** by Cloudflare's WAF (403, 2026-09-22) and seeded disabled.

**Hosted, read 2026-09-28:** three Archidekt runs (UTC): 2026-09-24 03:32 (failed on a deleted deck, the bug #105 fixed), 2026-09-24 14:16 and 2026-09-27 21:30 (both succeeded). `corpus.decks` holds 666 decks. The cron is scheduled for 10:15 UTC, and a Hobby-plan cron fires somewhere within that hour. None of the three runs started in that hour, so they were most likely started by hand. The daily trigger is either not reaching the search API or being refused before a run starts.

**Acceptance criteria:**
- [x] Archidekt probe from the VPS returns 2xx (2026-09-22)
- [x] The crawl's database path works against a real PostgREST (`TestLiveStoreRoundTrip`)
- [x] VPS configuration (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEARCH_API_CRON_TOKEN`) works: manual runs write decks
- [ ] **The daily cron produces a run.** Check the Vercel cron log for `/api/cron/archidekt-scrape` (401, 502, 503 or not firing), and `CRON_SECRET`, `SEARCH_API_URL`, `SEARCH_API_CRON_TOKEN` on Vercel Production
- [ ] Aggregation of `corpus.decks` into `commander_card_stats` / `card_global_stats` — T035 slice 2
- [ ] Moxfield: grants an accessible path (their bot whitelist wants a production domain, T033), the VPS probe returns 2xx, parsers pinned against live fixtures, then enable its crawl
- [ ] **A database role for the crawl that is not `service_role`.** The VPS container holds a key that bypasses RLS across the whole database, `auth` included, in the same process that serves public read endpoints. Doing this properly means a Postgres role granted execute on the `crawl_*` functions and nothing else, plus a JWT minted for it

---

### T009: Always-on commander request consumer

**Priority:** MEDIUM | **Area:** Backend / Worker | **Status:** Not started

`serve:commander-requests` runs by hand from this PC. Deck lookups queue in `commander_requests`, and nothing consumes them while it is off. T035 slice 10 plans to move it to the VPS worker.

**Files:**
- `apps/worker/src/cli.ts` — `serve:commander-requests`
- `apps/worker/src/lib/sync-runs.ts` — `finishRun`

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

**Priority:** LOW | **Area:** Database | **Status:** Not started

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

## Future / Lower Priority

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

**Priority:** LOW | **Area:** Backend / Scoring | **Status:** Superseded when T035 starts (slices 5–8)

Score cards by how they connect to the rest of the deck. T035's card-pair tables and deck affinity score are the planned design; this ticket stays only until that starts.

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
- **The data is loaded.** T035 slice 11 put EDHREC's per-commander numbers in `external_commander_card_stats`, including its published `synergy`, so this is now a query rather than a manual read of web pages.
- **What exists so far.** `spike:edhrec:prior` compares inclusion estimates, not synergy; a first look at Liesa's top ten synergy cards agreed within a few points.
- **Later.** T035 automates this as a per-commander benchmark in the offline evaluation (slice 6). This ticket is the one-off check until then.

**Acceptance criteria:**
- [ ] Pick ~5 commanders with the most decks in our corpus
- [ ] Compare their top synergy cards against EDHREC's from `external_commander_card_stats` (joined on `(commander_1, coalesce(commander_2, 0))`)
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
