# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

mtg-deck-rec: public Commander-only web app. Paste or import a decklist → cards to add, cards to cut, and functional substitutes (click a card) with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous; ranked by corpus play rate + Scryfall Tagger tags) and **collection-aware** (candidate pool restricted to owned cards).

Status: Phase 0 passed (go; the blind swap-quality eval is still open), and much of Phases 1–2 is built. The deck tool, card and commander pages and commander deck lookups run on real catalog and play-rate data, live at https://mtg-app-psi.vercel.app (Vercel + Supabase Free). Roadmap, Phase 0 report and current status with open backend items: `docs/roadmap/` (`execution-plan.md`, `phase0-report.md`, `status.md`).

## Commands

Yarn 4 workspaces (`nodeLinker: node-modules`), Node ≥ 24.

```sh
yarn install
yarn dev                                         # apps/web on http://localhost:3000 (local Supabase data; NEXT_PUBLIC_USE_MOCKS=1 for mocks)
yarn typecheck | yarn lint | yarn test | yarn build   # all workspaces
yarn workspace @mtg/web typecheck                # next typegen + tsc (typegen creates LayoutProps/PageProps globals)
yarn workspace @mtg/core vitest run src/contract/mocks/mocks.test.ts   # single test file
yarn workspace @mtg/core vitest run -t "swap"                          # tests matching a name

supabase start                                   # local Supabase: API 56321, Postgres 56322, Studio 56323 (own port range; other local stacks use the defaults)
supabase db reset                                # re-apply supabase/migrations from scratch
yarn workspace @mtg/worker cli sync:catalog      # Oracle Cards → cards, card_names, functional twins (skips if Scryfall's file is unchanged; --force)
yarn workspace @mtg/worker cli sync:printings    # All Cards → printings, card_stats (staple score), cheapest prices, flavor names (after sync:catalog)
supabase migration up                            # apply new migrations to the running local database
supabase gen types typescript --local            # regenerate apps/web/src/lib/server/database.types.ts after schema changes (write UTF-8 without BOM, LF line endings; PowerShell's Out-String adds CRLF)
yarn workspace @mtg/worker cli sync:tags         # Oracle Tags → tags, tag_edges, tag_closure, card_tags (run after sync:catalog)
yarn workspace @mtg/worker cli profile:tags      # tag data profile → X:\mtg_proj\reports
yarn workspace @mtg/web e2e                      # Playwright (apps/web/e2e) on a production build at :3300; E2E_BASE_URL=http://localhost:3100 to reuse a running server (installed Chrome), E2E_LOCAL_DATA=1 when it has the real catalog and corpus
yarn workspace @mtg/web regress                  # recommendation regression fixtures (JSON in X:\mtg_proj\regression, local DB) → pass/FAIL per check
yarn workspace @mtg/worker cli aggregate:corpus          # slim decks JSONL (default X:\mtg_proj\archidekt\spike\decks.jsonl) → commander_keys, commander_stats, card_global_stats, commander_card_stats (--force to rebuild unchanged file)
yarn workspace @mtg/worker cli:hosted <command>          # any worker command against the hosted database: loads apps/worker/.env.hosted (copy .env.example); plain `cli` always means local
yarn workspace @mtg/worker cli serve:commander-requests  # serve deck lookups queued from the deck tool until stopped (--once: until the queue is empty); run detached with a log
yarn workspace @mtg/worker cli spike:corpus:stability    # split-half resampling report → X:\mtg_proj\reports (sets minDecks/fullDecks evidence)
yarn workspace @mtg/worker cli spike:archidekt:rank     # rank legal commanders by update rate of their 100-card Archidekt decks, plus deck counts (1 req each, ~1 h, resumable) → X:\mtg_proj\archidekt\spike\commanders.json
yarn workspace @mtg/worker cli spike:archidekt:verify --top 100   # discount top commanders by share of listed decks they actually lead (~10 min)
yarn workspace @mtg/worker cli spike:archidekt:crawl --commander "Liesa, Forgotten Archangel"   # crawl specific commanders by exact card name (no ranking needed); then aggregate:corpus
yarn workspace @mtg/worker cli spike:archidekt:crawl --commanders 50 --per-commander 300 --order views   # most viewed first (or --order updated); resumable, 1 req/s; report → X:\mtg_proj\reports
```

**Branches:** `develop` is the working branch. Start every branch from `develop` and merge it back into `develop` (PRs with `--base develop`); `main` is merged from `develop` manually, and it's what Vercel production and the Supabase GitHub integration deploy. Until the hosted Supabase capacity issue is sorted, work locally: no hosted database, Vercel or production changes.

CI (`.github/workflows/ci.yml`, pushes to main, develop and `phase*/**`, PRs): install, typecheck, lint, unit tests, then `supabase start` on an empty database (proves migrations apply from scratch), a build with `NEXT_PUBLIC_USE_MOCKS=1`, and the e2e suite. Checks that need the real catalog, corpus or user decklists (regression harness, `E2E_LOCAL_DATA` tests, `X:\mtg_proj\tools` scripts) stay local: third-party decklists can't be public.

psql isn't installed locally; query the database with `docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres`.

TypeScript is pinned to 6.0.x on purpose: TS 7 (native) doesn't ship the JS compiler API, which typescript-eslint (via eslint-config-next) needs. Next 16.3 itself type-checks through the `tsc` CLI and would accept TS 7.

`apps/web` targets Next.js 16.3 — APIs differ from older versions. Read the bundled docs in `node_modules/next/dist/docs/` before writing Next code (see `apps/web/AGENTS.md`).

## Architecture

- `packages/core/src/contract/` is the **frontend/backend contract** and the source of truth for API shapes. Frontend builds against `createMockApis()` (`@mtg/core/mocks`); backend implements the same `RecsApi` / `ActionsApi` / `DataApi` interfaces. Change the contract via PR only. Contract v1 was frozen at the end of Phase 0 (`contract/version.ts` `CONTRACT_VERSION`). Later changes need approval from both frontend and backend, and must bump the version.
- Transport split: public reads are Server Components with `use cache` (pages must SSR and stay indexable); recommendations are Route Handlers `POST /api/recs/{swap,add,cut}` because Server Actions are dispatched serially; Server Actions handle deck parsing, analysis, link import and deck lookups.
- Core modules besides the contract: `formats/commander/` (color identity, partner pairs, bracket estimate, deck validation), `parse/` (decklists, name normalization, Archidekt decks), `scoring/` (corpus, swap, add and cut scoring, shared with the regression harness).
- `apps/web` runs with `cacheComponents: true`: uncached or request-time reads must sit inside `<Suspense>`; pair every `use cache` with `cacheLife`; `revalidateTag` takes a second (profile) argument. `proxy.ts` replaces `middleware.ts`.
- Client code reaches the contract only through `apps/web/src/lib/api/client.ts` (`getApis()`): the real Server Actions and route handlers, or the mocks with `NEXT_PUBLIC_USE_MOCKS=1` (CI builds that way, since its database has no catalog). The deck tool's request flow lives in `components/deck/use-deck-tool.ts` (event-handler driven, stale responses dropped by request counters).
- UI is shadcn/ui (`radix-nova` style, Radix primitives). Generated components import `cn` from the `cn` package (shadcn's clsx + tailwind-merge replacement), pinned to an exact version.
- `components/layout/ad-slot.tsx` marks future ad positions; it renders nothing until a slot is enabled. `/deck` is `noindex` — indexable content belongs on card/commander pages.

## Data pipeline

- `apps/worker` runs outside Next.js (tsx CLI). All outbound HTTP goes through `lib/http.ts` `politeFetch` (User-Agent, Accept, spacing, backoff). Bulk files download to `X:\mtg_proj\bulk`, named by Scryfall's `updated_at`.
- Sync jobs stage rows into temp tables on one reserved connection, check a sanity gate against the previous successful run's `sync_runs.metrics`, then merge in a single transaction. A crash leaves live tables untouched; a stale `running` row is marked `abandoned` by the next run. Prices update every run; card changes are detected by `content_hash`.
- Migrations live in `supabase/migrations`. New `public` tables are not auto-exposed to API roles: every migration must `grant` explicitly (select for `anon`/`authenticated` on public data, all for `service_role`) in addition to RLS policies.
- Tagger data caveats: `weight` is a string (almost always "median") and carries little signal; parent tags can have their own taggings; many broad tags are meta or trivia ("triggered ability", "alliteration"). Tag kill switch (`tags.disabled`) is keyed by UUID and never touched by sync.
- "Does the same job" uses `public.functional_tags`: descendants of the `app_config` allowlist (`functional_tag_roots`) minus descendants of the denylist (`functional_tag_denied_roots`), both stored as tag UUIDs. Tags can have several parents, so the denylist is needed to stop trivia leaking in through a functional parent.
- One `cards` row per oracle card: reprints, alternate art and flavor-named printings are rows in `printings`. Rules-identical cards with different names (Evolving Wilds / Terramorphic Expanse, Universes Beyond renames) stay separate cards, because Commander singleton is by name, and link to a base card via `cards.equivalence_base_id` (grouped by `rules_hash`, which masks the card's own names). `card_stats` collates reprint breadth and the staple score across a twin group.
- **`rec_swap_candidates` runs with `enable_nestloop = off`** (a function-level SET).
  - Why: its argument-dependent CTEs are estimated at about one row, and nested loops took 3–8 s on broad removal targets, where hash joins take 0.1–0.3 s.
  - Any `create or replace` of the function drops the setting, so repeat the SET.
  - Exclusive tag modes (`app_config.functional_tag_exclusive_groups`, currently sweeper vs spot removal) multiply tag similarity by `penalty` when a candidate has only a mode the target lacks.
- `rec_swap_candidates` selects its candidate pool with SQL weights that mirror `SWAP_WEIGHTS` in `@mtg/core/scoring` (no-corpus case). Change both together.
- **Deck corpus:** only aggregates live in Postgres; third-party decklists stay in local JSONL files.
  - **Shared filters:** `apps/worker/src/lib/corpus.ts` (`resolveDeck`) decides which decks count, for both `aggregate:corpus` and the stability job.
  - **Stored stats:** `card_global_stats.rate` is the baseline p0, computed over decks whose identity allows the card. `commander_card_stats` holds inclusion shrunk toward p0, (x + α·p0)/(n + α), and synergy = shrunk − p0.
  - **Settings:** `app_config.corpus` holds `shrinkAlpha`, `minDecks` (50) and `fullDecks` (100), measured by `spike:corpus:stability`.
  - **Web side:** `apps/web/src/lib/server/corpus.ts` finds a deck's commander key. Partner pairs below `minDecks` add each partner's single-commander decks. It recomputes card rates across those keys.
  - **Scoring:** `@mtg/core/scoring` `corpusComponent` blends commander and baseline scores. The baseline alone gets half the corpus weight, and commander decks ramp it to full weight at `fullDecks`.
- **Corpus play rates count a card only against decks updated in or after its release month.**
  - Release month comes from `card_stats.first_printed_at`, never `cards.released_at`: Oracle Cards dates a card by its representative, often latest, printing, which made Sol Ring look new.
  - Per-card eligible counts live in `card_global_stats.eligible_decks` and `commander_card_stats.eligible_decks`.
  - Histograms: `commander_stats.deck_months` holds decks per month; `corpus_identity_stats` holds decks per identity and month. They count eligible decks for cards no deck runs.
  - `corpusComponent` returns null (unknown, not low) when too few decks anywhere could have run a card. Add skips those cards.
  - `resolveDeck` drops decks whose two "commanders" aren't a legal pair (`isValidPartnerPair`). Archidekt's Commander category also holds companions and misfiled cards.
- Role checks use `commander_stats.role_profile`: the average cards per deck in each `deck_role_targets` role, from `loadRoleCards`, which mirrors `rec_card_roles`. `roleTargetsFor` in `apps/web/src/lib/server/recs.ts` moves the generic targets toward that profile by `commanderShare`, for both cut redundancy and add role gaps. Liesa decks, for example, average 15.8 removal against a generic target of 9.
- **Swap caching:**
  - `loadSwapPool` (candidates, card rows, tags, play rates) doesn't depend on the rest of the deck; `rankSwaps` removes the deck's own cards and blends scores.
  - The swap route calls `getCachedSwapSuggestions` in `lib/server/recs-cache.ts`: `use cache` + `cacheLife("hours")` + `cacheTag("recs")`, keyed by target, commander ids and the Game Changer setting. Collection-aware requests skip the cache.
  - Keep `next/cache` imports out of `recs.ts` so `yarn workspace @mtg/web regress` can run the recommendation code outside Next.js.
- **Deck import by link:**
  - A lone URL in the decklist box goes to `importDeckFromUrlAction`.
  - Archidekt: one request to `/api/decks/:id/`, converted by `@mtg/core/parse` `archidektDecklist` (primary category decides; sideboard, maybeboard and considering excluded), then resolved like pasted text.
  - Moxfield links return UPSTREAM_NOT_AUTHORIZED.
- **Commander deck lookups** (contract v2):
  - When an analyzed deck has one commander with confidence `none`, the deck tool (`use-commander-lookup.ts`, `commander-lookup.tsx`) checks `getCommanderCoverage` first. An active lookup is joined and shown ("someone else is also looking"); a standing not-enough or failed result shows a notice; otherwise it prompts.
  - Queue: `public.commander_requests`, one active row per commander (partial unique index). API roles only reach it through `get_commander_request`, `request_commander_decks` (rate limit per salted visitor hash, queue cap, cooldowns) and `get_commander_request_status`. Limits and the ETA pace (`secondsPerDeck`, `aggregateSeconds`) live in `app_config.commander_requests`.
  - Visitor key: sha256 of `RATE_LIMIT_SALT` + first `x-forwarded-for` address (required in production).
  - Worker `serve:commander-requests` claims with `skip locked`, heartbeats `worker_status` (the UI shows the collector as offline after 30 s), collects most-viewed decks into the corpus JSONL, then runs `aggregateCorpus({ force: true })`. Stale active rows (no heartbeat for 10 min) go back to queued.
  - When a status action first sees `done`, it calls `updateTag("corpus")` and `updateTag("recs")` so the visitor's refreshed recommendations and commander page are current immediately.
- **Cache refresh after syncs:** `finishRun(..., 'succeeded')` in `apps/worker/src/lib/sync-runs.ts` calls `refreshWebCaches(job)` (`lib/web-app.ts`), which POSTs the job's tags to `/api/internal/revalidate` (`revalidateTag(tag, "max")`, bearer `REVALIDATE_SECRET`, tags limited to catalog, corpus, recs). The worker needs `WEB_APP_URL` and the same `REVALIDATE_SECRET` in its environment; without them it logs and skips. Jobs call `finishRun` succeeded only after their transaction commits; keep it that way.
- **Rate limits and input validation:**
  - `@mtg/core/schemas` (`contract/schemas.ts`) holds zod schemas for every network input; `parseInput` maps oversized text/lists to PAYLOAD_TOO_LARGE, other problems to VALIDATION (first message plus `fieldErrors`).
  - `public.hit_rate_limit(bucket, visitor)` counts fixed windows in `rate_limit_hits`; budgets per bucket (`recs`, `deck`, `import`, `lookup`) live in `app_config.rate_limits`. `lib/server/rate-limit.ts` fails open if the check errors.
  - The recs routes share `handleRecsRequest` (`lib/server/recs-route.ts`): rate limit, validate, refuse account collections, run, map errors to status codes (429 with `Retry-After`). Server actions use `begin(bucket)` in `app/deck/actions.ts`. Visitor keys come from `lib/server/visitor.ts`.
- **Remembered deck:** `lib/saved-deck.ts` keeps the last deck in localStorage for 30 days: text, bracket and Game Changer choices, import source. The deck tool restores and re-analyzes it on mount; Clear forgets it. It's browser-only; nothing goes to the server.
- **Commander pages** (`/commander/[slug]`):
  - `loadCommanderPage` (uncached) is wrapped by `getCommanderPage` in `recs-cache.ts` (`cacheLife("days")`, tag `corpus`).
  - The page reads `params` inside `<Suspense>` and calls `notFound()` for unknown slugs, which alone would stream HTTP 200 with noindex.
- **Real 404s:** `src/proxy.ts` (matcher `/card/:slug`, `/commander/:slug`) checks that the card (live row) or commander key row exists and rewrites missing slugs to `/_not-found`, which renders `app/not-found.tsx` with status 404. Keep the check a superset of what the page loaders need, so it never 404s a page that would render; database errors fall through to the page. RSC navigation payloads for a missing slug return 404 in dev but 200 in production; the browser shows the not-found page either way. `X:\mtg_proj\tools\not-found-check.mjs [baseUrl]` checks the status codes.
  - Cards are ranked by `commanderCorpusScore` over the same release-aware rates as the deck tool, and banned cards are skipped.
- **Card pages** (`/card/[slug]`):
  - `loadCardPage` is wrapped by `getCardPage` in `recs-cache.ts` (cacheLife days; tags `catalog` and `corpus`).
  - Functional tags come through `card_functional_tags` (API roles can't read the `functional_tags` view).
  - Alternatives are a swap pool limited to the card's own color identity (`loadSwapPool` `identityMask`) and ranked with no deck.
  - "Commanders whose decks run it most" uses `card_top_commanders`, over decks updated since the card's release.
- **Sitemap and robots:** `app/sitemap.ts` lists the home page, commander pages with decks, and every card not marked not_legal. It reads them through the `sitemap_slugs` jsonb function, one value, so PostgREST's row cap doesn't apply. `app/robots.ts` disallows `/api/`. Absolute URLs come from `NEXT_PUBLIC_SITE_URL` (`lib/site.ts`, default `http://localhost:3000`), also used as `metadataBase`.
- Cards to add: `rec_add_candidates` orders its pool by the same corpus score as `commanderCorpusScore` (√baseline without commander decks); the app re-scores with `ADD_WEIGHTS` (corpus 0.8, role gap 0.2) and groups by `cardCategory`. Change both together. Cuts use commander play rates only at or above `minDecks`: `LOW_SYNERGY` below 0.35, and cards scoring ≥ 0.5 aren't flagged for cost or role overlap (generic role targets undercount what some commanders run).
- **Storage budget (free hosted tier, 500 MB):**
  - Compacted, the database is about 280 MB. Printings (all paper languages) are the biggest table.
  - Syncs must not rewrite unchanged rows: an update writes a new row version, so rewriting every row each run left tables at roughly twice their live size (561 MB before compaction). `sync:printings` upserts only printings whose content, card, prices or deleted state changed; `printings.prices_as_of` means when the price last changed (nothing reads it).
  - `cards` has fillfactor 80 so part of the daily reference-price update stays on the same page (about 25%; rows are wide). `card_tag_vectors` was dropped (never read).
  - Measured 2026-09-14: repeated daily-style syncs level off at cards ~142 MB, printings ~122 MB, whole database ~346 MB. Commander stats grow with each looked-up commander, so re-check before the corpus grows a lot.
  - Check size with `pg_database_size`; `VACUUM FULL` a table to see its live size.
- **Scheduled syncs:** `.github/workflows/sync.yml` runs catalog, printings and tags daily when repo variable `SYNC_ENABLED` is `true`. Secrets: `DATABASE_URL` (Supabase session pooler: IPv4, and the jobs need temp tables, so never the transaction pooler), `WEB_APP_URL`, `REVALIDATE_SECRET`. Corpus rebuilds and deck lookups run from the home PC instead, because the third-party decklists stay on X:.
- **Sitemap is built on request:** `app/sitemap.ts` calls `connection()` first, so `next build` never lists 32k slugs from the database (that exceeded the hosted anon statement timeout and failed a production deploy). `sitemap_slugs` reads the partial index `cards_sitemap_slugs` (index-only scan). Keep build-time prerendering away from queries that grow with the catalog.
- **Production builds need a reachable Supabase:** `next build` prerenders `/sitemap.xml`, which queries the database, so a build without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or with an unreachable database) fails with "Supabase isn't configured". Vercel needs them for Preview as well as Production.
- **Vercel specifics (project `mtg-app`, https://mtg-app-psi.vercel.app, root `apps/web`):**
  - Functions run in `cle1` (`apps/web/vercel.json`) next to the Supabase database in `us-east-2`; `iad1` round trips made card pages take seconds.
  - Vercel serves the prerendered `/_not-found` route with status 200, so `proxy.ts` rewrites missing slugs to `/_missing` (no route) to get a real 404.
  - Vercel overwrites `x-forwarded-for` with the caller's address, so e2e checks can't fake separate visitors there.
  - Supabase's GitHub integration applies `supabase/migrations` when `main` changes; `db-push.yml` is the manual fallback. Right after a bulk load, heavy queries (Sol Ring swaps) can hit the anon statement timeout until the database warms up.
- **Hosting (chosen 2026-09-14):** Vercel Hobby (noncommercial) for `apps/web`, Supabase Free for the database, GitHub Actions for Scryfall syncs, this PC for `aggregate:corpus` and `serve:commander-requests` against the hosted database.
- Postgres functions accept at most 100 arguments: build long literal lists with `ARRAY[...]`, not `jsonb_build_array(...)`.
- Archidekt (`apps/worker/src/sources/archidekt/`): read access rests on staff's forum permission (thread 40353) and the project being a noncommercial hobby; their Terms of Use forbid commercial use and automated queries, so monetizing needs written permission first. Requests go one at a time, ≥1 s apart. `/api/decks/v3/?commanderName=<name>&deckFormat=3&size=100&orderBy=-viewCount|-updatedAt&page=N` lists decks (also `edhBracket=1..5`); `count` is exact below 1000, capped at 1000, and pages continue past it. The filter also matches decks that merely contain the card, so `qualifyDeck` verifies the Commander category, format 3, public, exactly 100 cards (first category decides inclusion; Sideboard/Maybeboard/Considering never count). Never store `edhrecRank`/`salt`. Credit Archidekt with a link wherever its data is shown.

## Frontend

- Mobile-first is the top priority, and every card shown must show its image. Design direction is "Pocket binder": cool blue-grey page, white sleeves, 1px seams, binder blue (`--primary`) as the only interactive accent, mana colors only for color identity. Tokens live in `apps/web/src/app/globals.css`; fonts are Atkinson Hyperlegible Next (UI/body) and Sofia Sans Condensed (headings).
- Card images are hotlinked from Scryfall's CDN via `components/cards/card-image.tsx` (`unoptimized`; Scryfall already serves sized variants). Never overlay badges or UI on the lower part of a card image — Scryfall requires the artist/copyright line to stay visible; put badges below the image.
- `packages/core/src/contract/mocks/scryfall-cards.json` is real Scryfall data for the mock card pool (regenerate from the Scryfall collection endpoint, don't hand-edit images or prices).

## Local data

C: has little free space. Put large local data — Scryfall bulk downloads, caches, screenshots, Docker/Postgres storage — under `X:\mtg_proj`. Local Supabase requires Docker Desktop's disk image to be on X:.

`X:\mtg_proj\tools\shoot.mjs` captures phone (390px) and desktop screenshots of landing, `/deck` states, and the swap sheet with the locally installed Chrome: start the app on :3100, then `node X:\mtg_proj\tools\shoot.mjs`. Output goes to `X:\mtg_proj\screens`.

## Domain conventions

- `CardId` is an int surrogate 1:1 with Scryfall `oracle_id`. Decks and recommendations are oracle-level; collections are printing-level (`PrintingId` = Scryfall card id).
- Tagger tags are keyed by their **UUID**, never slug/label. Bulk data holds only direct taggings; parent tags are reached through the hierarchy.
- Prices are estimates and must always render with their as-of timestamp.
- Scryfall `edhrec_rank` is not used anywhere.

## Hard constraints

- No bot-detection circumvention anywhere: no cloudscraper-class libraries, fingerprint spoofing, UA rotation, or proxies. Every outbound request sends an accurate descriptive `User-Agent` (and `Accept` for Scryfall).
- Data sources qualify only by documented API, published terms, or direct operator permission. Do not add Deckstats, Aetherhub, MTGGoldfish, TappedOut, or EDHREC `json.edhrec.com`. Moxfield only if authorization is granted.
- Third-party decklists are used for aggregates only and never exposed.
- The repo is public: anti-abuse thresholds and scoring weights belong in database config, not code.
