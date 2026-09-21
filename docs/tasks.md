# Tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up.

Checked against [`docs/roadmap/status.md`](roadmap/status.md) and the code on **2026-09-18**. `status.md` is the narrative — why things are the way they are; this file is the queue. When they disagree, the code wins and both get corrected.

Ticket ids are stable and never reused: a closed ticket leaves a gap rather than renumbering the ones after it.

---

## Pre-Launch Hard Gates

Must complete before any public launch. These are blockers, not nice-to-haves.

### T001: Remove local test seed data

**Priority:** HIGH | **Area:** DevOps / Security | **Status:** Not started

Two files create fixed test accounts (`anon@test.local`, `admin@test.local`) and a sign-in link generator for local dev. They are safe today (seed.sql only runs via `supabase db reset`, the script checks `NEXT_PUBLIC_SUPABASE_URL` is localhost) but must not ship to production.

**Files:**
- `supabase/seed.sql` (line 4)
- `apps/web/scripts/dev-sign-in.ts` (line 5)

**Acceptance criteria:**
- [ ] Either delete both files, or prove hosted Supabase (built from `supabase/migrations` only) can never execute them
- [ ] Remove any references to these files from CLAUDE.md or docs
- [ ] Verify `supabase db reset` still works locally without them (or document new setup)

---

### T002: Configure hosted Supabase Auth

**Priority:** HIGH | **Area:** DevOps | **Status:** Not started

Sign-in emails break on hosted without these dashboard steps (not code — manual config).

**Steps:**
1. Add `/auth/confirm` and `/auth/callback` to Supabase Auth redirect allow list (dashboard → Authentication → URL Configuration)
2. Paste `supabase/templates/sign-in.html` into dashboard email templates
3. Set `SUPABASE_SECRET_KEY` on Vercel project (`mtg-app`) — needed by share-link kill switch (`lib/server/share-import.ts`)

**Acceptance criteria:**
- [ ] Sign-in email link works on hosted site
- [ ] Share-link kill switch activates on 403/409 responses

---

### T003: Deck report link destination

**Priority:** MEDIUM | **Area:** Frontend / UX | **Status:** Not started

The "Report" link on public deck pages opens a prefilled GitHub issue. Needs a real destination before public launch.

**Files:**
- `apps/web/src/app/decks/[commander]/[code]/page.tsx:123` — the `github.com/wuddat/mtg-deck-rec/issues/new` link

**Acceptance criteria:**
- [ ] Decide destination (email, form, in-app feedback)
- [ ] Update the link
- [ ] Remove GitHub issue template reference if present

---

### T004: Privacy policy + account deletion

**Priority:** MEDIUM | **Area:** Legal / Backend | **Status:** Not started

Auth data, salted IP hashes, and user-generated content require a privacy policy. Account deletion must cascade to collections, decks, and anonymize votes.

**Files:**
- `apps/web/src/app/account/` — account settings page
- `apps/web/src/lib/server/supabase-admin.ts` — admin client

**Acceptance criteria:**
- [ ] Privacy policy page linked from footer
- [ ] Account deletion function cascades: `deck_cards` → `decks`, `collection_items` → `collection_imports`, anonymizes `swap_votes`
- [ ] Deletion accessible from account settings

---

### T005: WotC Fan Content Policy disclaimer

**Priority:** LOW | **Area:** Legal / Frontend | **Status:** Not started

Footer disclaimer per WotC Fan Content Policy for MTG-related content.

**Files:**
- `apps/web/src/components/layout/site-footer.tsx`

**Acceptance criteria:**
- [ ] Disclaimer added to site footer
- [ ] Links to WotC Fan Content Policy

---

### T028: Decide whether public deck pages get indexed

**Priority:** MEDIUM | **Area:** Product / SEO | **Status:** Undecided

`/decks/[commander]/[code]` is `noindex` today because deck names are user-written and the only moderation is the report link in T003. Indexed deck pages are the project's biggest organic-traffic lever and also its moderation liability — the decision is a launch gate, not a code task.

**Files:**
- `apps/web/src/app/decks/[commander]/[code]/page.tsx` — the `robots` metadata
- `apps/web/src/app/sitemap.ts` — would need deck slugs added if indexed

**Context:** The route serves owner and stranger from one `loadDeckPage`, which returns null both for missing and for not-permitted, so a private deck is indistinguishable from a missing one. `proxy.ts` gives signed-out visitors a real 404 for them. Indexing would only ever cover public decks.

**Acceptance criteria:**
- [ ] Decide: stay `noindex`, or index public decks behind name moderation
- [ ] If indexing: a moderation path for deck names (report queue, or name filtering), and deck slugs in the sitemap
- [ ] Record the decision and its reason in `status.md`

---

## High-Impact Features

### T006: Wire votes into swap scoring

**Priority:** HIGH | **Area:** Backend / Scoring | **Status:** Not started

Votes are cast (`cast_swap_vote`) and stored in `swap_votes`, but nothing reads them for scoring. The weights are wired at 0.1 (swap) / 0.0 (add) in `SWAP_WEIGHTS` but the score component is effectively dead.

**Files:**
- `apps/web/src/lib/server/votes.ts` — vote reading
- `apps/web/src/lib/server/recs.ts` — recommendation pipeline
- `packages/core/src/scoring/swap.ts:13` — `SWAP_WEIGHTS`
- `packages/core/src/scoring/scoring.test.ts` — existing vote tests
- `apps/web/src/lib/server/database.types.ts:989` — `swap_votes` table schema

**Context:** The `/rate` rater UI is built (swipe rater slice 4). Votes carry `VoteContext` (source, position, candidates shown). Bayesian summary is returned by `cast_swap_vote`. The blind swap-quality eval (Phase 0 open item) needs 2 human raters using `/rate`.

**Acceptance criteria:**
- [ ] Read vote counts for (target, replacement) pairs into the swap scoring pipeline
- [ ] Blend votes into `SWAP_WEIGHTS` as a real component (not hardcoded 0)
- [ ] Add a vote-count confidence ramp (few votes → low weight, many → higher)
- [ ] Update existing tests to verify vote influence on rankings
- [ ] Run the swap-quality eval with real raters if possible

**Blocked by:** T014 — weights tuned on no votes are guesses. Collect the eval's votes first, then tune against them.

---

### T007: Price as scoring component ("Collection Fit")

**Priority:** MEDIUM | **Area:** Backend / Contract | **Status:** Decided, not built

The recommendation direction is "Collection Fit" — cheaper alternatives are preferred. This changes the contract (`ScoreComponent` union) and requires a version bump.

**Files:**
- `packages/core/src/contract/version.ts` — contract version
- `packages/core/src/contract/recs.ts:27` — the `ScoreComponent` union
- `packages/core/src/scoring/swap.ts` — swap weights
- `packages/core/src/scoring/add.ts` — add weights
- `apps/web/src/lib/server/recs.ts` — recommendation pipeline
- `apps/web/src/lib/server/recs-route.ts` — route handlers
- `supabase/migrations/` — new migration for price data in rec functions

**Context:** Prices come from Scryfall via the `printings` table; `cards.prices_as_of` tracks when a price last changed. Two things make this bigger than it looks:

1. *It changes the contract.* `ScoreComponent` is a closed union in `contract/recs.ts` and `ScoreBreakdown.components` is a `Record` over it, so adding `price` needs a version bump (v9 → v10) and updated mocks. The "Why this card" panel (shipped 2026-09-18) renders whatever components exist, so it picks up a price row for free once it has a label and an absent-reason.
2. *The SQL decides which candidates exist; the blend only decides their order.* `rec_swap_candidates` ends with a hard-coded `order by` mirroring the no-corpus half of `SWAP_WEIGHTS.collection_less`, then `limit p_limit`. A cheap card that scores badly on tag similarity is cut before TypeScript ever sees it — the budget suggestion the feature exists to make would be missing and nothing would look broken. So either mirror price into that `order by` or widen `p_limit` and pay for it.

**Decided, don't re-litigate:** the collection stays a **hard filter**, not a weighted term (owner decision 2026-09-18). Owned-only removes everything else from the pool; an owned card never outranks a better unowned one.

**Acceptance criteria:**
- [ ] Design the `ScoreComponent` extension for price delta
- [ ] Bump contract version to v10, update mocks and the changelog comment in `version.ts`
- [ ] Mirror price into `rec_swap_candidates` / `rec_add_candidates` `order by`, or widen `p_limit` — and **repeat `enable_nestloop = off`**, which `create or replace` drops
- [ ] Add a toggle beside "Suggest Game Changers" to turn cost weighting off
- [ ] Zero the price weight while owned-only is on (everything in the pool already costs nothing)
- [ ] Give the "Why this card" panel a label and absent-reason for the price component
- [ ] Update regression harness fixtures

---

### T008: Swap pool caching across serverless instances

**Priority:** HIGH | **Area:** Backend / Performance | **Status:** Not started

`loadSwapPool` (candidates, card rows, tags, play rates) doesn't depend on the rest of the deck. Currently cached via `use cache` per serverless instance, but cold queries still hit the hosted DB. Caching the pool somewhere that survives between instances would eliminate this.

**Files:**
- `apps/web/src/lib/server/recs-cache.ts` — `getCachedSwapSuggestions`
- `apps/web/src/lib/server/recs.ts` — `loadSwapPool`, `rankSwaps`
- `apps/web/src/lib/server/retry-timeout.ts` — timeout retry logic
- `apps/web/src/lib/server/database.types.ts` — `rec_timeouts` table

**Context:** The `cards_rec_pool` covering index already reduced reads from ~165 MB to ~46 MB. But the anon 3s statement timeout still fires on cold databases. The retry mechanism (up to 3 attempts) works because pages stay in `shared_buffers`, but it's a mitigation, not a fix.

**Changed by the search index (2026-09-19):** a swap request no longer fetches its 220 candidate card rows or the card-shaped half of `loadCardCorpus` from Postgres, leaving `rec_swap_candidates` itself as the one query. Whether that alone stops the timeouts is a hosted measurement nobody has taken — **re-read `rec_timeouts` a week after T032 lands before designing anything here.** The answer may be that this ticket is smaller than it looks, or already done.

**Acceptance criteria:**
- [ ] Design a caching strategy (Supabase materialized view, Redis, or extended `use cache` TTL)
- [ ] Implement caching for swap candidate pools
- [ ] Verify cold-query timeouts stop firing in `rec_timeouts`
- [ ] Keep the `cards_rec_pool` index columns and predicate in step with what the `eligible`/`pool` CTEs read and filter on

---

### T032: Deploy the search index to the VPS

**Priority:** HIGH | **Area:** Infrastructure | **Status:** Not started (the code is built and merged)

The Typesense index is built, tested and documented, and nothing uses it until it is running. Every read path falls back to Postgres while `TYPESENSE_URL` is unset, so this is safe to leave undone — it just means the work buys nothing.

**Files:**
- `deploy/search/docker-compose.yml` — the deployment (Typesense + `services/search-api`), with its `.env.example`
- `docs/roadmap/typesense-ops.md` — the runbook this ticket follows
- `.github/workflows/sync.yml` — already reads `SEARCH_API_URL` / `SEARCH_API_ADMIN_TOKEN` as secrets

**Context:** Self-hosted rather than Typesense Cloud (owner decision, 2026-09-19; the cheapest Cloud node is ~$21.60/mo plus egress). Typesense terminates no TLS of its own and its API key is its entire access control, so it is not exposed at all: `services/search-api` (Go, Fiber) is the only thing that talks to it, and that is what goes behind the reverse proxy.

**Acceptance criteria:**
- [ ] `docker compose up -d` in `deploy/search/` on the VPS, both containers healthy, **search-api** behind the reverse proxy with TLS (Typesense publishes no port and must stay that way)
- [ ] Three secrets generated: `TYPESENSE_ADMIN_KEY` (stays on the VPS), `SEARCH_API_ADMIN_TOKEN` (worker), `SEARCH_API_TOKEN` (web app)
- [ ] `SEARCH_API_URL` + `SEARCH_API_TOKEN` on Vercel **Production and Preview**; `SEARCH_API_URL` + `SEARCH_API_ADMIN_TOKEN` in GitHub Actions secrets and `apps/worker/.env.hosted`
- [ ] `cli:hosted sync:typesense --rebuild` once, then confirm the daily sync drains the queue
- [ ] `scripts/search-parity-check.ts` passes against hosted data (the local run has no deck corpus, so `commanders` and `commander_cards` have never been exercised with real rows)
- [ ] Measure RAM after the first build (`/metrics.json`) and record it in the runbook beside the estimate
- [ ] A week later, re-read `rec_timeouts` and update T008

---

## Accounts and Collections

### T025: Google sign-in credentials

**Priority:** LOW | **Area:** DevOps / Auth | **Status:** Code done, credentials missing

The Google OAuth flow is fully wired and hidden behind `NEXT_PUBLIC_AUTH_GOOGLE`, which is off because no credentials exist. Nothing to build — a console registration and two environment values.

**Files:**
- `apps/web/src/app/sign-in/actions.ts:72` — `startGoogleSignInAction`, refuses with FORBIDDEN while the flag is off
- `apps/web/src/app/sign-in/page.tsx:18` — passes `googleEnabled` to the form
- `supabase/config.toml` — `[auth.external.google]`

**Acceptance criteria:**
- [ ] Register an OAuth client in Google Cloud Console; redirect URI is the Supabase project's `/auth/v1/callback`
- [ ] Set client id and secret in the Supabase dashboard (and `config.toml` locally)
- [ ] Set `NEXT_PUBLIC_AUTH_GOOGLE=1` on Vercel
- [ ] Verify `/auth/callback` completes and creates a `profiles` row

---

### T026: Collection import from a share link

**Priority:** MEDIUM | **Area:** Backend / Frontend | **Status:** Partially decided, not built

`fetchShareLink` already takes `what: "deck" | "collection"` and the kill switch covers both, but the only caller is the deck tool's Archidekt deck import. Collections are paste- or file-only.

**Files:**
- `apps/web/src/lib/server/share-import.ts:35` — `fetchShareLink`, already collection-aware
- `apps/web/src/app/deck/actions.ts:107` — the one existing caller, as the pattern to copy
- `apps/web/src/app/collection/actions.ts` — where a collection-side action belongs
- `apps/web/src/components/collection/collection-tool.tsx` — the paste box that would accept a lone URL

**Context:** Approved sources are ManaBox, Archidekt and TCGplayer for URL import. Moxfield: text/CSV import only (API requires authentication). One request per user action, honest User-Agent, paste fallback when a source blocks — never work around a challenge. Fetched text goes through the same `parseCollectionText` / `resolveCollectionRowsAction` path as a paste.

**Acceptance criteria:**
- [ ] A lone URL in the collection box routes to an import action, like the deck tool's
- [ ] Only URLs the app builds for that source's own hosts; no redirect following
- [ ] Blocked or challenged source falls back to the paste instructions and trips the kill switch as `classifyShareResponse` decides
- [ ] Uses the `import` rate-limit bucket

---

### T027: 10k-row collection import timing check

**Priority:** LOW | **Area:** Performance | **Status:** Not started

Phase 3 planned a timing check for a large collection import that was never run. Collections match 2,000 rows per call, so a 10k-row import is five round trips plus the commit.

**Files:**
- `apps/web/src/app/collection/actions.ts` — `resolveCollectionRowsAction`, `saveCollectionBatchAction`
- `apps/web/scripts/collection-resolve-check.ts` — existing resolver check to extend

**Acceptance criteria:**
- [ ] Time a 10,000-row import end to end against the local database
- [ ] Record per-batch resolve time and commit time
- [ ] Confirm no statement times out, and that the browser stays responsive (the parse is in a Web Worker)
- [ ] Feed the numbers into T023's `maxEntries` decision

---

## Data Pipeline

### T009: Always-on commander request consumer

**Priority:** MEDIUM | **Area:** Backend / Worker | **Status:** Not started

`serve:commander-requests` currently requires manual run from this PC. Commander deck lookups queue in `commander_requests` but no consumer runs on hosted.

**Files:**
- `apps/worker/src/cli.ts` — `serve:commander-requests` command
- `apps/worker/src/jobs/` — job implementation
- `apps/worker/src/lib/sync-runs.ts` — `finishRun`

**Context:** The worker claims with `skip locked`, heartbeats `worker_status`, collects decks into corpus JSONL, then runs `aggregateCorpus`. Stale active rows (no heartbeat for 10 min) go back to queued.

**Acceptance criteria:**
- [ ] Deploy worker as a long-running process or scheduled job
- [ ] Verify `commander_requests` are consumed within reasonable time
- [ ] Monitor `worker_status` heartbeat from the UI

---

### T010: Archidekt always-on crawler

**Priority:** MEDIUM | **Area:** Data / Worker | **Status:** Not started

Currently manual crawl from this PC. A queue table would decouple crawling from the PC and allow automatic backfill.

**Files:**
- `apps/worker/src/sources/archidekt/` — Archidekt API client
- `apps/worker/src/cli.ts` — `spike:archidekt:crawl` command
- `apps/worker/src/lib/jsonl.ts` — JSONL output

**Acceptance criteria:**
- [ ] Design a `crawl_queue` table — there is no such table today; `commander_requests` is the nearest pattern to copy (partial unique index on one active row, `skip locked` claim, `worker_status` heartbeat)
- [ ] Implement a worker that processes the queue on a schedule
- [ ] Respect Archidekt rate limits (1 req/s, ≥1s apart)
- [ ] Track crawl progress and resumability

---

### T011: Monitor database growth

**Priority:** LOW | **Area:** DevOps | **Status:** Not started

Database is at 381/500 MB. Commander stats grow with each looked-up commander. Need to monitor before corpus grows.

**Files:**
- `supabase/migrations/` — potential future vacuum/compact jobs

**Acceptance criteria:**
- [ ] Add a periodic size check (SQL or worker job)
- [ ] Alert when approaching 450 MB
- [ ] Document compaction strategy (`VACUUM FULL` per table)

---

### T030: Invalid commander-pair `commander_keys` rows

**Priority:** LOW | **Area:** Data | **Status:** Known issue

Some `commander_keys` rows name two cards that aren't a legal partner pair — Archidekt's Commander category also holds companions and misfiled cards. `resolveDeck` now drops those decks (`isValidPartnerPair`), so the rows survive with no stats attached and no way to gain any.

**Files:**
- `apps/worker/src/lib/corpus.ts:165` — where `resolveDeck` rejects the pair
- `packages/core/src/formats/commander/validate.ts` — `isValidPartnerPair`
- `apps/worker/src/jobs/aggregate-corpus.ts` — writes `commander_keys`

**Context:** Harmless but confusing: a statless key can be linked to and renders a commander page with nothing on it. Deleting rows means checking nothing references them first.

**Acceptance criteria:**
- [ ] List the keys whose commanders aren't a legal pair and which have no `commander_stats` row
- [ ] Decide: delete them, or mark them so pages and `proxy.ts` treat them as missing
- [ ] Stop `aggregate:corpus` creating new ones
- [ ] Delete only the differing rows, never a table rewrite

---

## Testing

### T013: k6 load testing

**Priority:** LOW | **Area:** Performance | **Status:** Not started

No load testing done. Targets: p95 uncached swap < 800ms, add/cut < 1s at 50 rps.

**Files:** New file in `apps/web/` or `packages/core/`

**Acceptance criteria:**
- [ ] Write k6 scripts for swap, add, cut endpoints
- [ ] Run against local Supabase
- [ ] Document results and bottlenecks

---

### T014: Blind swap-quality eval (Phase 0 open item)

**Priority:** MEDIUM | **Area:** Quality | **Status:** Not started

Needs 2 human raters, 50 cases × 5 commanders, precision@5 + MRR. The `/rate` rater UI is built.

**Files:**
- `apps/web/src/app/rate/` — rater UI
- `apps/web/src/components/rater/` — rater components
- `apps/web/src/app/deck/actions.ts` — `castVoteAction`

**Context:** The last open Phase 0 gate, and the only one that needs people rather than code. The rater deals a card's top 6 replacements shuffled with our ranking hidden, which is what makes the result honest. Its votes are also the data T006 needs.

**Acceptance criteria:**
- [ ] Recruit 2 raters
- [ ] Run 50 cases × 5 commanders
- [ ] Measure precision@5 and MRR
- [ ] Document results in `docs/roadmap/phase0-report.md`

**Blocks:** T006 — vote weights can't be tuned until votes exist.

---

### T015: pgTAP tests for collection RLS

**Priority:** LOW | **Area:** Testing | **Status:** Not started

Collection RLS policies have no pgTAP tests. Deck RLS has extensive tests in `supabase/tests/saved-decks.sql`.

**Files:**
- `supabase/tests/` — add new test file
- `supabase/migrations/` — collection-related migrations

**Acceptance criteria:**
- [ ] Write tests for: owner can read/delete own collection, cannot read/delete another's
- [ ] Test `start_collection_import`, `save_collection_rows`, `commit_collection_import`
- [ ] Test limits: `maxImportRows`, `maxEntries`, `maxOpenImports`
- [ ] Add to CI or document manual run

---

## Future / Lower Priority

### T016: Deck export

**Priority:** LOW | **Area:** Frontend | **Status:** Not started

Export deck as text, CSV, or other formats.

**Acceptance criteria:**
- [ ] Text export (decklist format)
- [ ] CSV export (with set codes, quantities)
- [ ] Copy-to-clipboard

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

### T019: Admin pages (tag kill switch UI, sync status dashboard)

**Priority:** LOW | **Area:** Frontend | **Status:** Not started

Tag kill switch works via SQL but has no UI. Sync status is only in `sync_runs` table.

**Acceptance criteria:**
- [ ] Tag kill switch page (list tags, toggle disabled)
- [ ] Sync status dashboard (recent runs, metrics, errors)
- [ ] Admin-only access (or service_role only)

---

### T020: Deck-internal synergy scoring

**Priority:** LOW | **Area:** Backend / Scoring | **Status:** Not started

Score cards based on functional tag overlap with the rest of the deck. N² co-occurrence is too expensive for hosted DB; needs a cheaper approach.

**Files:**
- `packages/core/src/scoring/` — scoring modules
- `apps/web/src/lib/server/recs.ts` — recommendation pipeline

**Acceptance criteria:**
- [ ] Design a cheaper synergy metric (e.g., shared tag frequency, co-occurrence from corpus)
- [ ] Implement and test
- [ ] Blend into swap/add scoring

---

### T021: Retune partnerPoolWeight

**Priority:** LOW | **Area:** Scoring | **Status:** Not started

`partnerPoolWeight` 0.25 was calibrated on only 4 commander pairs (all including Rograkh). Retune when more pair data exists.

**Files:**
- `packages/core/src/scoring/corpus.ts:98` — `partnerPoolWeight` setting
- `apps/web/src/lib/server/corpus.ts:15` — default settings

**Acceptance criteria:**
- [ ] Re-run corpus stability with more partner pair data
- [ ] Adjust `partnerPoolWeight` if partner pair coverage improves
- [ ] Update `app_config.corpus` in database

---

### T031: Compare our synergy against EDHREC's — manually, terms first

**Priority:** LOW | **Area:** Data / Quality | **Status:** Pinned, blocked on a terms answer

`commander_card_stats.synergy` is shrunk inclusion − baseline p0, the same formula EDHREC documents, from our own corpus and with shrinkage they don't appear to apply. Comparing a handful of commanders against their published numbers is a cheap sanity check on our corpus — a comparison, never a source of truth.

**Context and hard limits:** `CLAUDE.md` forbids `json.edhrec.com` as a source, and a note from 2026-09-15 records that their terms forbid automated queries. A one-off manual read of public pages needs none of that. **Any ingestion, or anything automated, is blocked until the terms question is settled and the permitting language is written into `status.md`.**

**Acceptance criteria:**
- [ ] Pick ~5 commanders with the most decks in our corpus
- [ ] Compare their top synergy cards against EDHREC's, by hand
- [ ] Write up where we disagree and whether it looks like corpus size, shrinkage, or a bug
- [ ] Do **not** automate any fetch, and do not add EDHREC as a data source without written permission recorded in `status.md`

---

## Technical Debt

### T022: Play rate amplifying weak tag matches

**Priority:** LOW | **Area:** Scoring | **Status:** Known issue

Reliquary Tower tops Sea Gate Restoration swaps at 51% play rate despite 0.65 tag score. Play rate can lift weak tag matches above stronger ones.

**Files:**
- `packages/core/src/scoring/swap.ts` — swap scoring weights
- `packages/core/src/scoring/corpus.ts` — corpus component

**Acceptance criteria:**
- [ ] Investigate whether a tag-score floor or play-rate dampening is needed
- [ ] Test with regression fixtures
- [ ] Document decision

---

### T023: collections.maxEntries limit review

**Priority:** LOW | **Area:** Database | **Status:** Not started

`collections.maxEntries` is 100,000 (~23 MB/account). 6 maxed accounts exhaust free tier headroom. May need lowering before launch.

**Files:**
- `supabase/migrations/` — `app_config.collections`

**Acceptance criteria:**
- [ ] Review actual collection sizes in production
- [ ] Decide on a lower limit
- [ ] Update `app_config` via SQL migration

---

## Closed

Kept so the gaps in the numbering have a reason. Do not reuse these ids.

- **T012 — Parser test fixtures (26 → 60).** Closed 2026-09-18: the goal is met. `yarn workspace @mtg/core vitest run src/parse` reports **63 passing tests** across 8 files; the CSV and file-import work (PR #43) carried the count past 60. `status.md` still says 26 and is stale there.
- **T024 — Invalidate swap pool cache after corpus rebuilds.** Closed 2026-09-18: already wired. `TAGS_BY_JOB` in `apps/worker/src/lib/web-app.ts:10` maps `corpus_aggregate` to `['corpus', 'recs']`, so `finishRun` already revalidates `recs` after a rebuild. The premise that only `catalog` and `corpus` were sent was wrong.
