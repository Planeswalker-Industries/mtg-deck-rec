# Tasks

Open work items, grouped by priority. Each ticket is self-contained — enough context for a fresh model to pick it up.

Checked against [`docs/roadmap/status.md`](roadmap/status.md) and the code on **2026-09-21** (develop and main at PR #59). `status.md` is the narrative — why things are the way they are; this file is the queue. When they disagree, the code wins and both get corrected.

Ticket ids are stable and never reused: a closed ticket leaves a gap rather than renumbering the ones after it.

---

## Pre-Launch Hard Gates

Must complete before any public launch. These are blockers, not nice-to-haves.

### T002: Configure hosted Supabase Auth

**Priority:** HIGH | **Area:** DevOps | **Status:** Dashboard configured; SMTP pending (T033)

The hosted dashboard steps are done (URL configuration and the sign-in email template in Phase D, `SUPABASE_SECRET_KEY` on Vercel in Phase E). What remains is deliverability, which needs a real SMTP provider and a domain — that is T033.

**Steps:**
1. ~~Add `/auth/confirm` and `/auth/callback` to Supabase Auth redirect allow list (dashboard → Authentication → URL Configuration)~~ done
2. ~~Paste `supabase/templates/sign-in.html` into dashboard email templates~~ done
3. ~~Set `SUPABASE_SECRET_KEY` on Vercel project (`mtg-app`) — needed by share-link kill switch (`lib/server/share-import.ts`)~~ done

**Acceptance criteria:**
- [x] URL configuration and sign-in email template set on hosted
- [x] `SUPABASE_SECRET_KEY` set on Vercel (share-link kill switch)
- [ ] Sign-in email link works on hosted at a usable rate (T033)
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

The index and the Go service in front of it are built, tested and documented, and nothing uses them until they are running. Every read path falls back to Postgres while `SEARCH_API_URL` is unset, so this is safe to leave undone — it just means the work buys nothing.

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
- [ ] `services/search-api` reachable over TLS; `curl https://<host>/v1/health` returns `{"ok":true}` **without** `-k`
- [ ] A week later, re-read `rec_timeouts` and update T008

---

## Accounts and Collections

### T025: Google sign-in credentials

**Priority:** LOW | **Area:** DevOps / Auth | **Status:** Done (local and hosted)

The Google OAuth flow is fully wired behind `NEXT_PUBLIC_AUTH_GOOGLE`. The provider is enabled locally (`supabase/config.toml`, secret in `supabase/.env`) and on hosted (dashboard), the flag is set on Vercel, and both a local and the hosted round trip create a `profiles` row.

**Files:**
- `apps/web/src/app/sign-in/actions.ts:72` — `startGoogleSignInAction`, refuses with FORBIDDEN while the flag is off
- `apps/web/src/app/sign-in/page.tsx:18` — passes `googleEnabled` to the form
- `supabase/config.toml` — `[auth.external.google]`

**Acceptance criteria:**
- [x] Register an OAuth client in Google Cloud Console; redirect URI is the Supabase project's `/auth/v1/callback`
- [x] Set client id and secret in the Supabase dashboard (and `config.toml` locally)
- [x] Set `NEXT_PUBLIC_AUTH_GOOGLE=1` on Vercel
- [x] Verify `/auth/callback` completes and creates a `profiles` row

---

### T027: 10k-row collection import timing check

**Priority:** LOW | **Area:** Performance | **Status:** 1,000-row path fixed; 10k check not run

Phase 3 planned a timing check for a large collection import that was never run. Collections match 2,000 rows per call, so a 10k-row import is five round trips plus the commit.

**Done 2026-09-20 (PRs #56, #58):**
- `8f0eb1b` — PostgREST's `max_rows` (1000) silently truncated `resolve_collection_rows` responses, so a 1,487-row export reported 487 cards NOT_FOUND. Matching now goes in chunks of `MATCH_ROWS_PER_CALL`; `collection-resolve-check.ts` asserts a 1,200-row batch.
- `34b0ee3` — a 1,000-row import hit the 3 s `anon` timeout on hosted (9.3 s warm). Branches now short-circuit and `printings_set_cn_cover` makes set + number index-only. Local buffers per 1,000 rows: Scryfall ids 16,742 → 4,011, set + number 12,779 → 3,089. Migration `20260920000100_collection_resolve_short_circuit.sql`.

**Files:**
- `apps/web/src/app/collection/actions.ts` — `resolveCollectionRowsAction`, `saveCollectionBatchAction`
- `apps/web/scripts/collection-resolve-check.ts` — existing resolver check to extend

**Acceptance criteria:**
- [ ] Re-run a 1,000-row import on hosted now that `20260920000100` is on main, and confirm it no longer times out
- [ ] Time a 10,000-row import end to end against the local database
- [ ] Record per-batch resolve time and commit time
- [ ] Confirm no statement times out, and that the browser stays responsive (the parse is in a Web Worker)
- [ ] Record the numbers beside `app_config.collections` so a future limit change has evidence

---

### T033: Hosted custom SMTP and custom domain

**Priority:** MEDIUM | **Area:** DevOps / Auth | **Status:** Not started

Hosted Auth is configured (T002, T025) but email deliverability is not. Supabase's built-in SMTP sends only a couple of emails an hour and is explicitly not for production, so the email-code sign-in path cannot be relied on. Google sign-in covers the owner in the meantime; the email path needs a real SMTP provider, and most providers need a domain you control.

**Steps:**
1. Point a domain at the app and set it as the custom URL.
2. Resend (free tier, ~3k/month) or equivalent: verify the sending domain, then Supabase → Authentication → SMTP with its credentials.
3. Raise Authentication → Rate Limits → emails per hour past the default.
4. Move the URL settings to the domain: Supabase Site URL and redirect allow list, Vercel `NEXT_PUBLIC_SITE_URL`, and the Google OAuth client's authorized redirect URIs.

**Acceptance criteria:**
- [ ] Custom domain serves the app and is on the Auth redirect allow list
- [ ] Custom SMTP sends sign-in emails at a production rate
- [ ] `NEXT_PUBLIC_SITE_URL` and the Google OAuth redirects updated for the domain

### T034: Lazy rendering for large collections in the collection view

**Priority:** LOW | **Area:** Frontend / Performance | **Status:** Tabled (owner, 2026-09-21), revisit when real collections grow

`/collection` renders every card in every open group. Images are already lazy (`CardImage` uses native lazy loading), so the cost is DOM and React work: about ten elements per card. A 729-card collection loads in ~0.6 s on phone and desktop and filters instantly. At ~10,000 cards that becomes ~100,000 elements rebuilt on every search keystroke or toggle; `useDeferredValue` keeps typing responsive, but results would lag.

**Files:**
- `apps/web/src/components/collection/collection-view.tsx`: the groups and the filter memo
- `apps/web/src/components/cards/pocket-grid.tsx`: the grid each group renders
- `packages/core/src/collection/index.ts`: filter rules, which run on data and stay as they are

**Options, cheapest first** (discussed 2026-09-21):
1. `content-visibility: auto` on each group or row. One CSS rule; the browser skips layout and paint off-screen, and find-in-page, zoom and links keep working. It doesn't reduce React's render work, so filter changes on a huge collection stay slow.
2. Render the first N cards per group (around 60) with a "Show N more" button, only for groups over a threshold (around 100). Bounded work at any size, and counts stay exact because filtering runs on data. Costs one tap per big group, and find-in-page only sees what's shown.
3. Virtualise the grid (e.g. TanStack Virtual). Handles 30k cards, but the container-query columns (3 to 6 across) must be measured and re-measured, collapsible headers need one virtual list covering headers and rows, find-in-page breaks, and zoom triggers unmount when their row leaves the buffer.

Recommendation: 1 first, 2 when a real collection needs it, 3 only if 2 isn't enough. Constants for N and the threshold go at the top of the file (coding policy).

**Acceptance criteria:**
- [ ] Measure first: a synthetic 10,000-card browser collection from the local catalog. Time the initial load, a search keystroke and a colour toggle, before and after.
- [ ] Apply option 1, and option 2 if the numbers call for it
- [ ] Filter counts stay exact, and collapsing a group still works
- [ ] `e2e/collection.spec.ts` still passes

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

**Priority:** LOW | **Area:** Frontend | **Status:** Not started (admin shell exists)

Tag kill switch works via SQL but has no UI. Sync status is only in `sync_runs` table.

**Since PR #47:** `/admin` exists as a React Admin app with platform-admin guards (proxy, page, API) and a users resource only. Both pages here become new resources in it rather than a separate area — see `apps/web/AGENTS.md` for the admin data flow.

**Files:**
- `apps/web/src/components/admin/admin-app.tsx` — register new resources
- `apps/web/src/components/admin/data-provider.ts` — admin data flow
- `apps/web/src/components/admin/users.tsx` — the existing resource, as the pattern

**Acceptance criteria:**
- [ ] Tag kill switch page (list tags, toggle disabled)
- [ ] Sync status dashboard (recent runs, metrics, errors)
- [ ] Admin-only access through the existing platform-admin guards and security-definer functions

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

## Closed

Kept so the gaps in the numbering have a reason. Do not reuse these ids.

- **T026 — Collection import from a share link.** Closed 2026-09-21 for Archidekt. A lone link to a public Archidekt collection in `/collection/import` downloads it through Archidekt's own export endpoint (CSV with Scryfall ids, 2,500 rows a page, a second apart, four pages per server call) and imports it like an uploaded file; a 4,651-row collection took about 30 s end to end locally. ManaBox, Moxfield and TCGplayer links get a message saying how to export from that app: ManaBox and TCGplayer publish no share-link format, and Moxfield's API needs an account. **Open:** if the owner has a real ManaBox or TCGplayer share link, it can be looked at and added as a second source behind the same action. **Owner check:** a large collection is several requests to Archidekt (spaced a second apart, capped at 20), which departs from the "one request per user action" wording in CLAUDE.md's Hard constraints.
- **T011 — Monitor database growth.** Closed 2026-09-21: hosted moved to Supabase Pro with 8 GB, so the 500 MB ceiling this watched for is gone (416 MB at the upgrade). One leftover from PR #62: once `20260921000200_english_printings_only.sql` is on hosted, `vacuum full public.printings;` (superuser) returns ~120 MB. No longer urgent, still tidy.
- **T023 — collections.maxEntries limit review.** Closed 2026-09-21: the worry was six maxed accounts (~23 MB each) filling the free tier. On Pro's 8 GB the 100,000 limit stays.

- **T001 — Remove local test seed data.** Closed 2026-09-21: kept for local testing, fenced off from hosted. `seed.sql` now opens with a guard that raises if `auth.users` holds any account besides the two test ids, which every hosted database does and a fresh `supabase db reset` never does. Nothing that builds hosted runs it anyway: the GitHub integration applies migrations and does not seed the production branch, and `db push` skips seeds without `--include-seed`. The accounts have no password and undeliverable addresses, and `dev-sign-in.ts` refuses a non-local database URL. Google sign-in covers real accounts.
- **T004 — Privacy policy + account deletion.** Closed 2026-09-21. `/privacy` (linked from the footer) is a boilerplate policy drafted from how the app stores data. Owner decisions it records: a deleted account's email and id stay in `audit_log` to catch ban evasion and multiple accounts; submitted data (decks, collections, votes, lookups) is used to improve recommendations and never sold or used for anything else. Deletion is `delete_my_account()` (migration `20260921000100_account_deletion.sql`) behind a typed confirmation on `/account`; existing cascades remove profile, decks, collection and admin membership, the `on_auth_user_deleted` trigger re-keys votes to a random voter key on every delete path, and `tags.disabled_by` is now `on delete set null`. No automated test deletes anything, by owner rule; the owner tested a deletion by hand.
- **T005 — WotC Fan Content Policy disclaimer.** Closed 2026-09-21: the footer disclaimer now links to the policy.
- **T012 — Parser test fixtures (26 → 60).** Closed 2026-09-18: the goal is met. `yarn workspace @mtg/core vitest run src/parse` reports **63 passing tests** across 8 files; the CSV and file-import work (PR #43) carried the count past 60. `status.md` still says 26 and is stale there.
- **T024 — Invalidate swap pool cache after corpus rebuilds.** Closed 2026-09-18: already wired. `TAGS_BY_JOB` in `apps/worker/src/lib/web-app.ts:10` maps `corpus_aggregate` to `['corpus', 'recs']`, so `finishRun` already revalidates `recs` after a rebuild. The premise that only `catalog` and `corpus` were sent was wrong.
