# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep the four project docs in step.** This file (repo-wide rules: architecture, data pipeline, database, hard constraints, coding policy), [`apps/web/AGENTS.md`](apps/web/AGENTS.md) (web-app detail), [`docs/tasks.md`](docs/tasks.md) (open work) and [`docs/roadmap/status.md`](docs/roadmap/status.md) (current state) describe one project. Any change to this file is checked against the other three in the same edit. Each fact lives in one of them only; the others link to it.

## Project

mtg-deck-rec: public Commander-only web app. Paste or import a decklist → cards to add, cards to cut, and functional substitutes (click a card) with an estimated cost delta. Two modes share one pipeline: **collection-less** (anonymous; ranked by corpus play rate + Scryfall Tagger tags) and **collection-aware** (the player's collection filters or reorders the candidate pool).

Live at https://mtg-app-psi.vercel.app (Vercel + Supabase Pro + a VPS for the search index and deck crawls). Current state: `docs/roadmap/status.md`. Open work: `docs/tasks.md`. The next data pipeline (corpus in Postgres, card-pair statistics, deck affinity scoring, full commander crawl) is `docs/roadmap/card-graph-plan.md`, tracked as T035: slice 11 (EDHREC statistics) is built, the rest waits for a backend owner. The daily deck crawl that feeds it is `docs/roadmap/deck-crawl.md` (built under T036; open: its daily trigger T042, a crawl database role T043, Moxfield T044). Phase 0 history: `docs/roadmap/execution-plan.md`, `phase0-report.md`.

The GitHub repo is `Planeswalker-Industries/mtg-deck-rec`, a shared organisation repo (moved from `wuddat/mtg-deck-rec`, which redirects). User-Agent strings, in-app links and the search API's Go module path use the organisation address.

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
supabase migration up                            # apply new migrations to the running local database
supabase gen types typescript --local            # regenerate apps/web/src/lib/server/database.types.ts after schema changes (write UTF-8 without BOM, LF line endings; PowerShell's Out-String adds CRLF)

yarn workspace @mtg/worker cli sync:catalog      # Oracle Cards → cards, card_names, functional twins (skips if Scryfall's file is unchanged; --force)
yarn workspace @mtg/worker cli sync:printings    # All Cards → English paper printings, sets, card_stats (staple score), cheapest prices, flavor names (after sync:catalog)
yarn workspace @mtg/worker cli sync:tags         # Oracle Tags → tags, tag_edges, tag_closure, card_tags (after sync:catalog)
yarn workspace @mtg/worker cli sync:typesense [--rebuild]  # drain public.search_index_queue into the search index (--rebuild: every collection from scratch, alias swapped when done)
yarn workspace @mtg/worker cli aggregate:corpus  # slim decks JSONL (default X:\mtg_proj\archidekt\spike\decks.jsonl) → commander_keys, commander_stats, card_global_stats, commander_card_stats (--force to rebuild an unchanged file)
yarn workspace @mtg/worker cli import:edhrec [--force]   # EDHREC commander pages saved by X:\mtg_proj\tools\edhrec-crawl.mjs → external_commanders, external_commander_card_stats (no requests)
yarn workspace @mtg/worker cli serve:commander-requests  # serve deck lookups queued from the deck tool until stopped (--once: until the queue is empty); run detached with a log
yarn workspace @mtg/worker cli profile:tags      # tag data profile → X:\mtg_proj\reports
yarn workspace @mtg/worker cli:hosted <command>  # any worker command against the hosted database: loads apps/worker/.env.hosted (copy .env.example); plain `cli` always means local
yarn workspace @mtg/worker cli spike:corpus:stability    # split-half resampling report → X:\mtg_proj\reports (evidence for minDecks/fullDecks)
yarn workspace @mtg/worker cli spike:edhrec:prior        # holdout test: EDHREC vs the colour baseline as the prior for commanders with few decks → X:\mtg_proj\reports
yarn workspace @mtg/worker cli spike:archidekt:rank      # rank legal commanders by update rate of their 100-card Archidekt decks, plus deck counts (1 req each, ~1 h, resumable) → X:\mtg_proj\archidekt\spike\commanders.json
yarn workspace @mtg/worker cli spike:archidekt:verify --top 100   # discount top commanders by share of listed decks they actually lead
yarn workspace @mtg/worker cli spike:archidekt:crawl --commander "Liesa, Forgotten Archangel"   # crawl specific commanders by exact card name; then aggregate:corpus
yarn workspace @mtg/worker cli spike:archidekt:crawl --commanders 50 --per-commander 300 --order views   # most viewed first (or --order updated); resumable; report → X:\mtg_proj\reports

docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres -q < supabase/tests/<file>.sql   # SQL checks, each rolls back:
#   saved-decks.sql          saved-deck functions and isolation (needs the local catalog)
#   deck-snapshots.sql       deck originals: written once, owner-only, readable when the deck is
#   collection-editing.sql   hand edits: card totals over printing entries, own collection only
#   card-search.sql          deckbuilder search: colours, types, mana value, paging (needs the local catalog)
#   platform-admins.sql      platform admin guard and user management
#   admin-crawled-decks.sql  /admin/crawls functions: admin-only reads of the corpus
#   external-stats.sql       EDHREC stats tables: no API role reads them, constraints, cascade (needs the local catalog)
#   crawl-commanders.sql     per-commander crawl queue: diff-only seed, queue order, visit stamps, service_role only (needs the local catalog)
docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres -q < supabase/demo/admin-demo.sql   # demo accounts, decks and collections for /admin (commits; re-runnable)

docker compose -f docker-compose.search.yml up -d --build  # local Typesense (56325) + the search API (56326); the VPS runs deploy/typesense/ and deploy/search-api/ separately
cd services/search-api && go test ./...          # the search API (Go, Fiber); it fakes Typesense, so it needs nothing running
cd services/search-api && SUPABASE_TEST_URL=http://127.0.0.1:56321 SUPABASE_TEST_SERVICE_KEY=<service key> go test ./internal/crawl/ -run Live   # the crawl's store against a real PostgREST; skipped without both variables

yarn workspace @mtg/web e2e                      # Playwright (apps/web/e2e) on a production build at :3300 (runs `next start`, so `build` first or it tests a stale bundle); E2E_BASE_URL=http://localhost:3100 to reuse a running server (installed Chrome), E2E_LOCAL_DATA=1 when it has the real catalog and corpus
yarn workspace @mtg/web regress                  # recommendation regression fixtures (JSON in X:\mtg_proj\regression, local DB) → pass/FAIL per check
```

Web check scripts (`yarn workspace @mtg/web tsx scripts/<name>.ts`, add `--env-file=.env.local` where a database is needed) are listed in `apps/web/AGENTS.md`.

**Branches:** `develop` is the working branch. Start every branch from `develop` and merge it back into `develop` (PRs with `--base develop`); `main` is merged from `develop` manually, and it's what Vercel production and the Supabase GitHub integration deploy.

CI (`.github/workflows/ci.yml`, pushes to main, develop and `phase*/**`, PRs): install, typecheck, lint, unit tests, then `supabase start` on an empty database (proves migrations apply from scratch), a build with `NEXT_PUBLIC_USE_MOCKS=1`, and the e2e suite. It fails a PR that reuses a migration version. Checks that need the real catalog, corpus or user decklists (regression harness, `E2E_LOCAL_DATA` tests, `X:\mtg_proj\tools` scripts) stay local: third-party decklists can't be public.

**Local test accounts:** `supabase/seed.sql` creates `anon@test.local` and `admin@test.local` on `supabase db reset`; the admin one is in `public.platform_admins`, the other deliberately is not. Sign in with `yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts anon` (run from `apps/web/`), which mints a link directly and costs none of the local email budget. It also takes a plain email address (the `@demo.local` cast from `admin-demo.sql`) and checks the account exists first, because `generateLink` **creates** an unknown one. The seed raises the local `auth` rate-limit budget, since every e2e sign-in comes from one address. `seed.sql` opens with a guard that raises if `auth.users` holds any other account, so it only runs on a fresh reset and never on hosted.

psql isn't installed locally; query the database with `docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres`.

TypeScript is pinned to 6.0.x on purpose: TS 7 (native) doesn't ship the JS compiler API, which typescript-eslint (via eslint-config-next) needs.

## Architecture

- `packages/core/src/contract/` is the **frontend/backend contract** and the source of truth for API shapes. Frontend builds against `createMockApis()` (`@mtg/core/mocks`); backend implements the same `RecsApi` / `ActionsApi` / `DataApi` interfaces. Change the contract via PR only; every change needs approval from both frontend and backend and bumps `CONTRACT_VERSION` (`contract/version.ts`, with a changelog comment per version).
- Core modules besides the contract: `formats/commander/` (color identity, partner pairs, bracket estimate, deck validation), `parse/` (decklists, CSV, name normalization, Archidekt decks, EDHREC pages), `scoring/` (corpus, swap, add and cut scoring, shared with the regression harness), `journey/` (deck journey and deckbuilder reducers), `collection/` (filter and edit rules), `search/` (search-index document shapes).
- `apps/web` is Next.js 16.3 (Vercel). Transport, caching, UI and admin rules are in `apps/web/AGENTS.md`.
- `apps/worker` is a tsx CLI outside Next.js for syncs, aggregates and imports.
- `services/search-api` is a Go (Fiber) service on the VPS: the only client of Typesense, and the host of the deck crawl.

## Data pipeline

### Writing data

- All worker outbound HTTP goes through `lib/http.ts` `politeFetch` (User-Agent, Accept, spacing, backoff). Bulk files download to `X:\mtg_proj\bulk`, named by Scryfall's `updated_at`.
- Sync jobs stage rows into temp tables on one reserved connection, check a sanity gate against the previous successful run's `sync_runs.metrics`, then merge in a single transaction. A crash leaves live tables untouched; a stale `running` row is marked `abandoned` by the next run. Prices update every run; card changes are detected by `content_hash`.
- **Writes touch only the rows that change.** Unless a task explicitly asks for a full rebuild, never delete-and-reinsert or update a whole table for a small change. Diff the new rows against the live ones (`is distinct from`, content hashes, `except`) and write only the differences. This applies to sync jobs, aggregates, migrations and one-off fixes alike. Why: every rewritten row leaves a dead row version, so a full rewrite roughly doubles a table on disk until vacuum, and bloat costs cache and vacuum time. For the same reason there are no materialized views (`refresh` rewrites every row).
  - Tolerances: `aggregate:corpus` skips shrunk inclusion and synergy moves under 0.001, and the tag sync skips idf moves under 0.0001.
- **A new column the catalog upsert must fill goes into `content_hash`.** The upsert only writes a row when `content_hash` or `rules_hash` differs, so an unhashed column stays empty forever on existing cards. Adding one rewrites every card row once (`cards` has fillfactor 80, so the new versions mostly fit in place). A new hashed column is empty on hosted until a sync rewrites the rows.
- Migrations live in `supabase/migrations`. New `public` tables are not auto-exposed to API roles: every migration must `grant` explicitly (select for `anon`/`authenticated` on public data, all for `service_role`) in addition to RLS policies.
- Postgres functions accept at most 100 arguments: build long literal lists with `ARRAY[...]`, not `jsonb_build_array(...)`.
- **Cache refresh after syncs:** `finishRun(..., 'succeeded')` (`apps/worker/src/lib/sync-runs.ts`) drains the search index queue, then `refreshWebCaches(job)` (`lib/web-app.ts`) POSTs the job's tags (catalog, corpus, recs) to `/api/internal/revalidate` with bearer `REVALIDATE_SECRET`. The worker needs `WEB_APP_URL` and the same `REVALIDATE_SECRET`; without them it logs and skips. Jobs call `finishRun` succeeded only after their transaction commits; keep it that way.
- **Scheduled syncs:** `.github/workflows/sync.yml` runs catalog, printings and tags daily when repo variable `SYNC_ENABLED` is `true`. Secrets: `DATABASE_URL` (Supabase **session** pooler: IPv4, and the jobs need temp tables, so never the transaction pooler), `WEB_APP_URL`, `REVALIDATE_SECRET`, `SEARCH_API_URL`, `SEARCH_API_ADMIN_TOKEN`. Corpus rebuilds, EDHREC imports and deck lookups run from the home PC, because the third-party decklists and EDHREC pages stay on X:.

### Catalog

- One `cards` row per oracle card: reprints, alternate art and flavor-named printings are rows in `printings`. Rules-identical cards with different names (Evolving Wilds / Terramorphic Expanse, Universes Beyond renames) stay separate cards, because Commander singleton is by name, and link to a base card via `cards.equivalence_base_id` (grouped by `rules_hash`, which masks the card's own names). `card_stats` collates reprint breadth and the staple score across a twin group.
- **Printings are English only** (`sync:printings` skips `lang <> 'en'`; the sanity-gate metric is `englishPrintings`). A collection row naming another language resolves through the English printing with the same set and number and keeps its own `lang`. `public.sets` (name, type, release date) comes from the same All Cards file.
- `cards.keywords` holds Scryfall's rules keywords only (Flying, Menace), GIN-indexed for grouping a deck by keyword. "Life gain", "removal" and the like are Tagger tags in `card_tags`; the two stay separate because their sources differ in reliability.
- `cards.artist` is the artist of the representative printing, the same one `images` comes from. It is not in `CardSummary`; `CARD_COLUMNS` in `lib/server/cards.ts` selects it onto `CardRow`.
- `cards.mana_cost` is the printed cost (`{2}{W}{W}`): a split card's whole cost, a double-faced card's front face, `''` for none. It is in `content_hash` and reaches the app as `CardSummary.manaCost` (contract v19); null until `sync:catalog` has run after the migration.
- `printings.prices_as_of` and `cards.prices_as_of` mean when a price last changed. Pages show `prices_checked_at()` (the newest successful catalog or printings sync) as the as-of date, applied in `fetchCardsById`.
- Tagger data caveats: `weight` is a string (almost always "median") and carries little signal; parent tags can have their own taggings; many broad tags are meta or trivia ("triggered ability", "alliteration"). The tag kill switch (`tags.disabled`) is keyed by UUID and never touched by sync.
- "Does the same job" uses `public.functional_tags`: descendants of the `app_config` allowlist (`functional_tag_roots`) minus descendants of the denylist (`functional_tag_denied_roots`), both stored as tag UUIDs. Tags can have several parents, so the denylist stops trivia leaking in through a functional parent. `functional_tags_all` is the same without the kill-switch filter (the search indexer walks it).

### Recommendations (SQL side)

- **`rec_swap_candidates` and `rec_add_candidates` run with `enable_nestloop = off`** (a function-level SET). Why: their argument-dependent CTEs are estimated at about one row, and nested loops made them take seconds where hash joins take milliseconds. Any `create or replace` of these functions drops the setting, so repeat the SET.
- **Both pick their candidate pool through the covering index `cards_rec_pool`** (`id` include `color_identity`, `game_changer`, `name`, `mana_value`, `equivalence_base_id`, where the row is live, commander-legal and not a basic land), so a request never sweeps the whole `cards` heap and falls out of cache. Keep the index's columns and predicate in step with what the two `eligible`/`pool` CTEs read and filter on; the price update never writes these columns, so `cards` keeps its HOT updates.
- Exclusive tag modes (`app_config.functional_tag_exclusive_groups`, currently sweeper vs spot removal) multiply tag similarity by `penalty` when a candidate has only a mode the target lacks.
- `rec_swap_candidates` orders its pool with SQL weights that mirror `SWAP_WEIGHTS` in `@mtg/core/scoring` (no-corpus case). Change both together (T035 slice 1 moves weights to `app_config.scoring` and ends the mirror).
- `rec_add_candidates` orders its pool by the same corpus score as `commanderCorpusScore` (√baseline without commander decks), over the corpus sources with their weights (`p_key_weights`) and per-key colour identity, like `loadCardCorpus`. The app re-scores with `ADD_WEIGHTS` (corpus 0.8, role gap 0.2) and groups by `cardCategory`. Change both together. An older `p_deck_count` overload is no longer called and is due to be dropped (T040).
- Cuts use commander play rates only at or above `minDecks`: `LOW_SYNERGY` below 0.35, and cards scoring ≥ 0.5 aren't flagged for cost or role overlap (generic role targets undercount what some commanders run).
- Role checks use `commander_stats.role_profile`: the average cards per deck in each `deck_role_targets` role, from `loadRoleCards`, which mirrors `rec_card_roles`. `roleTargetsFor` (`apps/web/src/lib/server/recs.ts`) moves the generic targets toward that profile by `commanderShare`, for both cut redundancy and add role gaps.
- **Statement-timeout retry:** `lib/server/retry-timeout.ts` wraps both functions at all four call sites and retries up to three attempts, only when Postgres cancelled the statement (SQLSTATE 57014). It works because a cancelled attempt leaves the pages it read in `shared_buffers`; it is a mitigation, not the fix (T008). Three is the cap because each attempt can burn the full 3 s `anon` timeout.
  - A query that runs out of retries is recorded in `public.rec_timeouts` via `log_rec_timeout`: one row per query shape with a `hits` counter and `last_seen`. RLS on with no policies: read it with psql or as `service_role`. Recording is fire-and-forget and swallows its own errors. Worst offenders: `select fn, target_card_id, commander_ids, hits, last_seen from public.rec_timeouts order by hits desc limit 20;`

### Deck corpus and play rates

- **Where decks live today:** `aggregate:corpus` reads Archidekt decks from JSONL on X:. The daily crawl (T036) also writes decklists into the private `corpus` schema, but nothing aggregates `corpus.decks` yet. Only aggregates are public tables.
- **Shared filters:** `apps/worker/src/lib/corpus.ts` (`resolveDeck`) decides which decks count, for both `aggregate:corpus` and the stability job. It drops decks whose two "commanders" aren't a legal pair (`isValidPartnerPair`): Archidekt's Commander category also holds companions and misfiled cards.
- **Stored stats:** `card_global_stats.rate` is the baseline p0, computed over decks whose identity allows the card. `commander_card_stats` holds inclusion shrunk toward p0, (x + α·p0)/(n + α), and synergy = shrunk − p0.
- **Settings:** `app_config.corpus` holds `shrinkAlpha`, `minDecks` (50) and `fullDecks` (100), measured by `spike:corpus:stability`, `partnerPoolWeight` (0.25) and `severeSynergyScore` (0.2).
- **Release-aware counting:** a card counts only against decks updated in or after its release month.
  - Release month comes from `card_stats.first_printed_at`, never `cards.released_at`: Oracle Cards dates a card by its representative, often latest, printing, which made Sol Ring look new.
  - Per-card eligible counts live in `card_global_stats.eligible_decks` and `commander_card_stats.eligible_decks`. `commander_stats.deck_months` and `corpus_identity_stats` hold decks per month (and per identity) for cards no deck runs.
  - `corpusComponent` returns null (unknown, not low) when too few decks anywhere could have run a card. Add skips those cards.
- **Partner pooling (web side):** `apps/web/src/lib/server/corpus.ts` loads every commander key that shares one of a deck's commanders; `pickCorpusSources` (`@mtg/core/scoring`) decides which count.
  - A key with `minDecks` decks of its own stands alone. Below that, every other key led by one of its commanders is borrowed at `partnerPoolWeight` per deck. A card's eligible decks count only sources whose colours allow it, and confidence never reaches `full` while borrowing.
  - `CommanderKeyRef.deckCount` counts only decks with exactly those commanders; `borrowedDeckCount` holds the rest, and `CorpusEvidence.pooled` marks weighted counts. Commander pages need decks of their own.
  - Why 0.25: borrowed decks predicted a pair's own top cards better than colour-only rates, but every pair measured includes Rograkh; retune when more pair data exists (T021).
- **Scoring:** `@mtg/core/scoring` `corpusComponent` blends commander and baseline scores. The baseline alone gets half the corpus weight, and commander decks ramp it to full weight at `fullDecks`.
- **EDHREC statistics (T035 slice 11, loaded locally and on hosted, not yet read by any code):** `external_commanders` and `external_commander_card_stats` hold EDHREC's published per-commander card counts, kept apart from our own deck counts because EDHREC aggregates the same Archidekt and Moxfield decks. Intended use (`card-graph-plan.md`, "External statistics"): a prior for commanders below `minDecks`, and a benchmark.
  - **Two steps.** `X:\mtg_proj\tools\edhrec-crawl.mjs` fetches `json.edhrec.com/pages/commanders/<slug>.json` for every slug in EDHREC's `commanders.xml` sitemap (about one request per 1.5 s, honest User-Agent, resumable) into `X:\mtg_proj\edhrec\commanders`. Then `import:edhrec` loads the files (`edhrecCommanderPage`, `@mtg/core/parse`) with the usual stage, sanity-gate, diff-only merge.
  - **A missing page on `json.edhrec.com` is S3's 403 `AccessDenied`, not a block.** It is a static bucket behind CloudFront. The crawler counts those as missing and stops on any other 403 or on 20 in a row.
  - **Commanders are keyed by their cards, not by `commander_keys`** (EDHREC covers ~6,800 commanders; `commander_keys` rows are our commander pages). Join on `(commander_1, coalesce(commander_2, 0))`.
  - **Resolution:** cards by the Scryfall printing id EDHREC shows (`printings.id`), then by name. A commander needs every name on the page to match one card, so a pair with an unknown partner can't pass for the other partner alone. Flavor-name pages duplicate the real card's page, so each card pair keeps one page.
  - **EDHREC is the better prior** (`spike:edhrec:prior`, 2026-09-28): on 49 commanders with 200+ of our decks, its estimates beat the colour baseline at every deck count tested. Full table in `card-graph-plan.md`.
  - **EDHREC trims its lists** for big commanders (down to about 5% of decks): a missing row means not published, not never played.
  - Not stored: `salt`, `rank`, prices, images, page panels. Not exposed: RLS on, no API grants, never shown in the UI. Hosted load: `cli:hosted import:edhrec` from this PC.
- **Commander deck lookups** (contract v2): a deck whose commander has no corpus can request decks.
  - Queue: `public.commander_requests`, one active row per commander (partial unique index). API roles only reach it through `get_commander_request`, `request_commander_decks` (rate limit per salted visitor hash, queue cap, cooldowns) and `get_commander_request_status`. Limits and the ETA pace live in `app_config.commander_requests`.
  - Worker `serve:commander-requests` claims with `skip locked`, heartbeats `worker_status` (the UI shows the collector offline after 30 s), collects most-viewed decks into the corpus JSONL, then runs `aggregateCorpus({ force: true })`. Stale active rows (no heartbeat for 10 min) go back to queued. It runs by hand from this PC (T009).
  - When a status action first sees `done`, it calls `updateTag("corpus")` and `updateTag("recs")`.
- **Archidekt worker client** (`apps/worker/src/sources/archidekt/`): read access rests on staff's forum permission (thread 40353). Requests go one at a time, ≥ 1 s apart. `/api/decks/v3/?commanderName=<name>&deckFormat=3&size=100&orderBy=-viewCount|-updatedAt&page=N` lists decks (also `edhBracket=1..5`); `count` is capped at 1000 but pages continue past it. The filter also matches decks that merely contain the card, so `qualifyDeck` verifies the Commander category, format 3, public, exactly 100 cards (first category decides inclusion; Sideboard/Maybeboard/Considering never count). Never store `edhrecRank`/`salt`. Credit Archidekt with a link wherever its data is shown.

### Deck crawls (T036)

A daily Vercel cron hits `/api/cron/{source}-scrape`, which POSTs `/cron/:source/scrape` on the search API, which crawls in the background and writes decklists into the private `corpus` schema. It goes **commander by commander** from a queue seeded from EDHREC's list (`corpus.crawl_commanders`), listing each one's 100-card decks most viewed first: `firstVisitPages` (1) on a first visit, then `revisitPages` (1) on a revisit, which re-reads that page and fetches only the decks whose listed update time moved. `maxFetchesPerCommander` (120) bounds one visit, because a page cap does not — 40 pages is 2,400 fetches. The queue is ordered by **need**: `crawl_commanders.held_decks`, recounted by `crawl_seed_commanders` at the start of every run, puts commanders under `targetDecks` (60) first, so the crawl stops spending the same effort on a commander with five hundred decks as on one with three. Engine `services/search-api/internal/crawl/`, adapters `internal/archidekt/` (active) and `internal/moxfield/` (blocked).
  - **The pace is 1 s + up to 0.2 s jitter and adapts** (owner decision 2026-10-03: Archidekt has been taking that rate). A 429 doubles the interval up to `requestIntervalMaxMs` (8 s); `paceRecoverRequests` (60) clean responses return it to the base. It is adaptive rather than a flat safe number because 1 s drew 429s on 2026-09-14: a fixed pace has to be slow enough for the worst day. `corpus.crawl_runs.throttles` and `throttled_position` record how often the source pushed back and where the crawl was, since a count alone cannot say where to look. `docs/roadmap/deck-crawl.md` is the full account and runbook.

- **The `corpus` schema is reached only through `public.crawl_*` security-definer functions**, executable by `service_role` alone. Exposing `corpus` to PostgREST is exactly what a schema holding third-party decklists must not do; and PostgREST can't express compound conditions like the claim, so those belong in functions.
- **The claim is the mutex, and a stale claim is taken over.** `crawl_claim` locks the source's row, so two crons cannot both crawl; a claim untouched for `staleClaimSeconds` (6 h) may be seized, since a killed container can never release its own. `crawl_release` only releases a claim the caller still holds.
- **A crawl outlives the request that started it**, so the server owns it: one cancellable context, a WaitGroup drained on shutdown, one goroutine per source. Closing writes use `context.WithoutCancel`, and the compose files set `stop_grace_period: 60s` so the drain isn't SIGKILLed.
- **Never walk an update-ordered list.** Archidekt bumps `updatedAt` faster than a polite crawl can page, so the site-wide `-updatedAt` walk this replaced only ever collected decks edited during the run (hosted runs 1–5). View order holds still between visits.
- **A deck counts toward a commander only if that commander leads it.** `commanderName` also matches decks that merely run the card; those are kept (a real deck, already fetched) but not counted.
- **A commander with no decks under its name or front face is `not_found`**, and one whose first page holds no deck it leads is `no_led_decks`: that is the verification log for EDHREC names Archidekt doesn't use, and `not_found` stays out of the queue until cleared by hand.
- **A deck is qualified on the deck, never on the browse filters**: Commander format, public, a commander, exactly 100 cards, the same rules as `qualifyDeck`. A failing deck is `skipped_unqualified`; only a page that stopped looking like itself is a `ShapeError`, which quarantines the run.
- **Uncategorized cards are in the deck**: only a card whose primary category is an excluded board is dropped.
- **Decks are stored by card id** (`commander_card_ids int[]`, `cards` as `{card id: quantity}`): `crawl_upsert_decks` resolves the source's oracle ids once, on write, so no read joins on oracle id. A deck naming a card the catalog doesn't have yet is not stored but counted in `skipped_unresolved`, and refetched on the next visit (owner decision 2026-10-03). Joining the old text oracle ids to `cards.oracle_id` cast the indexed side, read the whole `cards` heap and timed out hosted run 8.
- **Quantities are kept** (with `deck_size`). The content hash covers sorted commanders and card/quantity pairs as oracle ids, so a reshuffled list does not rewrite the row; `crawl_upsert_decks` writes a row only when its hash or listed update time changed, and held decks are read per list page (`crawl_deck_versions`), never per run. A held deck whose listed time has not moved is never fetched again.
- **A deck that is gone (404/410) is stepped over** and counted in `skipped_missing`; at least 20 missing *and* over half of the attempts fails the run, so a moved endpoint can't report success over an empty corpus.
- **A scrape proves it can reach its database before it answers 202**: `Runner.Preflight` makes the run's first read and answers 502 on failure (bounded at 10 s), which the web route passes through, so Vercel records a failed cron instead of silence.
- **The cron is authorized by `CRON_SECRET`** (compared constant-time), never by `x-vercel-cron-schedule` or the user agent, which any caller can send. Unset `CRON_SECRET` is 503.
- **A single 403 or challenge disables the source** (`crawl_disable`) and writes an `audit_log` row (`action = 'crawl.disabled'`). A challenge is recognised by `cf-mitigated: challenge` or HTML challenge markers, never by a substring of a JSON body, since deck names are user-written.
- **Moxfield is seeded disabled**: it answered Cloudflare's hard WAF block (2026-09-22), so the right number of requests is zero. Its parser refuses anything that is not exactly 100 cards.
- The search API holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS across the whole database. A dedicated restricted role is open work (T043).

### Search index (Typesense behind the search API, on the VPS)

The highest-volume reads are document lookups, which cost Postgres a heap visit each. `docs/roadmap/typesense-plan.md` says what moved and why; `docs/roadmap/typesense-ops.md` is the runbook; `services/search-api/README.md` is the service.

- **Nothing but `services/search-api` talks to Typesense.** Typesense publishes no port. Three secrets, each able to do less: `TYPESENSE_ADMIN_KEY` stays on the VPS; `SEARCH_API_ADMIN_TOKEN` (worker, sync workflow) reads and writes; `SEARCH_API_TOKEN` (Vercel) only reads. The two tokens must differ; the service refuses to start otherwise.
- **It is not a Typesense proxy.** Endpoints answer the project's questions ("these 500 cards", "does this slug have a page"), so chunking, paging and ranking live there. Documents are opaque to it: their shape is defined once in `@mtg/core/search`, and the Go service reads only `card_id` and `slug`.
- **It is an optimisation, never a dependency.** With `SEARCH_API_URL` unset (CI, a fresh checkout) every read takes its Postgres query; with the index slow or broken, `fromIndex` logs, returns null and the caller falls through to the same query. The contract did not change for it.
- **Liveness and readiness are different endpoints**: the container probe asks `/v1/health/live`, so a Typesense outage the app already falls back from doesn't restart-loop the API. `/v1/health` reports Typesense. `search-api healthcheck` is a mode of the same binary (distroless has no shell).
- **Deployed as two compose files** (`deploy/typesense/`, `deploy/search-api/`) on a hand-made external Docker network `mtg-search`, because the two have different lifecycles; `docker-compose.search.yml` runs both locally.
- **Four collections**: `cards`, `tags`, `commanders`, `commander_cards`.
  - Keyed by the stable surrogate id, never the slug (a rename changes a slug).
  - Colour identity is indexed as letters as well as the bitmask, since Typesense has no bitwise operators (`identityFilter`).
  - Timestamps are written in PostgREST's shape (`+00:00`) so an index read and a fallback read produce the same string.
  - `name_head` (first word of every name) carries the "starts with beats contains" tier, weighted above `name` and `names`. `name` and `names` match inside words (`infix`), as Postgres's `%bolt%` did; `name_head` does not.
  - `oracle_text` and `card_faces` are absent: only the card page needs them, and it is cached for days.
  - Card documents carry every tag, including disabled ones; the kill switch is applied at read time (`tagRefsFromDocument`), so turning a tag off needs no reindex.
- **Triggers write a queue; the worker drains it.** Every source table writes the document's stable key into `public.search_index_queue` (upsert-keyed, bounded by distinct documents). Nothing in Postgres talks to Typesense.
  - No "upsert or delete" column: the drain looks the key up, and gone or soft-deleted means remove.
  - The delete compares on `seq` (a bigint), never `enqueued_at`: postgres.js truncates timestamps to milliseconds, which once made the drain loop forever. The drain stops rather than repeat a batch it could not clear.
  - Changes with no cheap card list (tag hierarchy, functional allow/deny lists) enqueue a `'*'` sentinel that reindexes the collection.
  - Drains run after every successful sync, in the daily workflow, and via `cli sync:typesense` by hand. `.github/workflows/search-index.yml` rebuilds or drains on demand (`workflow_dispatch`; over the API the input is the string `"rebuild": "true"`).
- **A schema change needs `sync:typesense --rebuild`**; a drain cannot add a field. A rebuild builds a versioned collection and moves the alias only when complete, so it is always safe.
- **Still in Postgres, on purpose:** `rec_swap_candidates` and `rec_add_candidates` (the index cannot express idf-weighted tag-closure similarity), `resolve_card_names` (parser correctness), `resolve_collection_rows` (printing-level, exact identifiers), and everything a user owns (an index has no row-level security).

### Accounts, decks and collections (database side)

Web behaviour for these features (the tool, pages, auto-save, proxy rules) is in `apps/web/AGENTS.md`.

- **Accounts:** email code + link (`signInWithOtp`, template `supabase/templates/sign-in.html`) and Google (live locally and on hosted, behind `NEXT_PUBLIC_AUTH_GOOGLE=1`; `[auth.external.google]` in `supabase/config.toml`). `public.profiles` gets a row per new user via `on_auth_user_created`. Sign-in attempts use the `auth` rate-limit bucket.
  - The email link is `{{ .RedirectTo }}&token_hash=...`, with the redirect always `/auth/confirm?next=...`; that redirect must be on the Auth redirect allow list (`additional_redirect_urls` locally, the dashboard on hosted) or the link breaks.
  - Locally `[auth.rate_limit] email_sent = 30` per hour, which repeated full e2e runs with `E2E_MAILPIT_URL` exhaust. After editing auth settings in `config.toml`, run `supabase stop && supabase start`.
  - **Account deletion** (`delete_my_account()`): acts on `auth.uid()` only, refuses the last platform admin, keeps the email and user id in `audit_log` (owner decision: abuse and ban-evasion tracking; `/privacy` says so), then deletes the `auth.users` row and lets the cascades take profile, decks and collection. `on_auth_user_deleted` re-keys that account's `swap_votes` to a random `x:` voter key. **Never test deletion automatically** (owner rule 2026-09-21): no script or test calls it, locally or hosted.
- **Saved decks:** `public.decks` and `public.deck_cards`, limits in `app_config.decks` (`maxDecks`, `maxCards`, `maxNameChars`).
  - A deck is its **name and its list of cards**; the pasted text is not stored.
  - Ids are **uuid** (not enumerable, survive a rename); URLs carry `decks.code`, a 12-character random string, **never anything derived from the name**.
  - Owners read and delete their own decks directly; anyone reads public ones. Every write goes through `save_deck`, `rename_deck`, `set_deck_visibility` and `duplicate_deck`: security definer, `auth.uid()` only, caps applied. `save_deck` writes only the card rows that differ and never changes an existing deck's visibility.
  - **New decks are public**, so a deck is never created without the player asking (see AGENTS.md).
  - **`include_in_corpus` is set from legality alone, never from `is_public`.** Hiding a deck does not remove it from the aggregates, and the visibility control's copy must say so. (T035 slice 3 changes this to complete-and-legal.)
  - **A save stores only a bracket the player chose** (owner decision 2026-09-27); an estimated bracket is recomputed on reopen.
  - **`listMyDecks` filters by `user_id` explicitly and must keep doing so**: new decks are public and `public_decks_read` lets anyone read them, so RLS alone lists every public deck as "yours".
  - **Originals (contract v12):** `save_deck_original` keeps the deck the player brought once, in `deck_snapshots` (kind `original`, cards as one jsonb value, readable exactly when the deck is). A deck that has one keeps it.
  - `loadDeckPage` returns null both for a missing deck and one the viewer may not see, so a private deck is indistinguishable from a missing one.
- **Collections:** one per account. `collection_items` (one row per card, printing or none, finish, condition, language), staged `collection_import_rows`, `collection_imports`. Users read and delete their own rows directly; writes go through `start_collection_import`, `save_collection_rows`, `commit_collection_import` and `set_collection_card_quantity` (security definer, `auth.uid()` only, `app_config.collections` limits `maxImportRows`, `maxEntries`, `maxOpenImports`). Nothing changes until commit; merge adds quantities, replace swaps the collection. `my_collection_entries()` (jsonb) and `my_owned_card_ids()` (`integer[]`) each return one value, so PostgREST's row cap never truncates them.
  - A hand edit is a **card-level total** over printing-level entries: added copies go into the card's generic entry (no printing, nonfoil, NM, en); removed copies come out of generic entries first, then imported ones latest first. The account does it in `set_collection_card_quantity` (per-user advisory lock); a browser collection uses `setCardQuantity` (`@mtg/core/collection`, same rule, tested).
  - Ownership modes (contract v13): **'only'** limits adds and swaps to owned cards, flags NOT_OWNED cuts and uses the collection-aware swap weights. **'first'** suggests from every card and sorts owned ones as if they scored `app_config.ownership.firstBoost` higher (`rankKey`); the score shown stays the card's own. 'first' is the default and conflicts with an earlier owner decision (T007, T037).
- **Collection matching:** `resolve_collection_rows` matches up to 2,000 rows per call (Scryfall id, TCGplayer id, set + number + language, set + number, then name) and returns `catalog_epoch()`.
  - **Each branch drives only on the rows no earlier branch matched**, and is skipped when the row lacks that identifier; running all branches for every row blew the 3 s `anon` timeout. Keep new branches in that chain rather than adding a `union all`.
  - **Every branch that picks one printing out of several ends its ordering on `printings.id`**, so a re-import can't land on a different printing.
  - **`printings_set_cn_cover`** makes the set + number branch an index-only scan. It only pays while `printings` is vacuumed, so the table carries `autovacuum_vacuum_scale_factor = 0.05`.
- **Import formats** (`@mtg/core/parse`): ManaBox, Moxfield, Archidekt and TCGplayer are approved sources, each exporting CSV and text.
  - **CSV columns are matched by header name, never by app** (`parse/collection-csv.ts`), with preference order within a field (TCGplayer's `Simple Name` over `Name`, `Set Code` over `Set`). Unrecognised columns are ignored.
  - **Every column past quantity and name is a hint**: used when readable, dropped when not. The Scryfall id is the point of reading CSV at all.
  - **CSV is recognised by its header row, not by commas** (card names contain commas). `parse/csv.ts` is ours: quoted fields, doubled quotes and a BOM are the whole spec.
  - **A deck CSV collapses to `quantity name`** (`decklistFromFile`); text decklists pass through untouched.
  - **Tokens are not in the catalog** (`NON_DECK_LAYOUTS`), so token rows come back unmatched (owner decision 2026-09-18).
- **Swap votes:** `cast_swap_vote` records, changes or clears (value 0) a vote on a (target, replacement) pair in `public.swap_votes` and returns the pair's Bayesian summary (prior in `app_config.votes`). Each vote keeps what the voter saw (`VoteContext`). Signed-in votes are keyed to `auth.uid()`, others to the salted visitor hash. Nothing reads votes for scoring yet (T006).
- **Platform admins:** `public.platform_admins`; every admin read or write is a security-definer function opening with `require_platform_admin()` (`admin_list_users`, `admin_set_platform_admin`, `admin_set_tag_disabled`, `admin_list_sync_runs`, and the `admin_*` crawl readers). `admin_set_tag_disabled` records who, when and why, and audits only real changes.
- **Rate limits and input validation:** `@mtg/core/schemas` holds zod schemas for every network input; `parseInput` maps oversized input to PAYLOAD_TOO_LARGE, other problems to VALIDATION. `public.hit_rate_limit(bucket, visitor)` counts fixed windows in `rate_limit_hits`; budgets per bucket (`recs`, `deck`, `deck_write`, `import`, `lookup`, `collection`, `auth`, `vote`, `search`, `admin`) live in `app_config.rate_limits`. The check fails open if it errors. Visitor key: sha256 of `RATE_LIMIT_SALT` + first `x-forwarded-for` address (required in production).
- **Share-link imports:** every deck or collection link fetch goes through `fetchShareLink` (`lib/server/share-import.ts`): only URLs the app builds for that source's own hosts, no redirects, honest User-Agent. `classifyShareResponse` (`@mtg/core/parse`) decides what came back. A Cloudflare challenge, or a 403/409 outside the site's usual format, switches that source off in `share_import_sources` (via `SUPABASE_SECRET_KEY`) and writes an `audit_log` row; a 403 in the usual format just means the list isn't public. A switched-off source makes no requests until someone sets `enabled` back to true.
  - Decks: Archidekt links (one request to `/api/decks/:id/`); Moxfield is text/CSV only (its API needs an account).
  - Collections: Archidekt links, through the same paged export Archidekt's own button calls (see Hard constraints for the request budget). ManaBox, Moxfield and TCGplayer links get instructions instead of a request.

### Hosting

- **Vercel Hobby** (noncommercial) for `apps/web`, project `mtg-app`, functions in `cle1` next to the database. Details in `apps/web/AGENTS.md`.
- **Supabase Pro** (8 GB, `us-east-2`). Its GitHub integration applies `supabase/migrations` when `main` changes; `db-push.yml` is the manual fallback. The integration can come unlinked with no failing check: after a release, confirm that hosted `supabase_migrations.schema_migrations` reached the newest version. A migration applied by hand must be marked with `supabase migration repair --status applied <version>` before `db push`, or the push runs it again. **Release trap:** merging a migration to `develop` publishes a Vercel preview that still runs against `main`'s schema, so a migration adding a column to a shared read path breaks the develop preview until `main` catches up.
- **VPS** (Dokploy, Traefik): Typesense, the search API and the deck crawl.
- **GitHub Actions**: Scryfall syncs and search index rebuilds.
- **This PC**: `aggregate:corpus`, `import:edhrec` and `serve:commander-requests` against the hosted database.
- Check database size with `pg_database_size`; `VACUUM FULL` a table to see its live size. Storage is no longer a constraint.

## Local data

C: has little free space. Put large local data — Scryfall bulk downloads, caches, screenshots, Docker/Postgres storage — under `X:\mtg_proj`. Local Supabase requires Docker Desktop's disk image to be on X:.

`X:\mtg_proj\tools\shoot.mjs` captures phone (390px) and desktop screenshots with the locally installed Chrome: start the app on :3100, then `node X:\mtg_proj\tools\shoot.mjs`. Output goes to `X:\mtg_proj\screens`.

## Domain conventions

- `CardId` is an int surrogate 1:1 with Scryfall `oracle_id`. Decks and recommendations are oracle-level; collections are printing-level (`PrintingId` = Scryfall card id).
- Tagger tags are keyed by their **UUID**, never slug/label. Bulk data holds only direct taggings; parent tags are reached through the hierarchy.
- Prices are estimates and must always render with their as-of timestamp.
- Scryfall `edhrec_rank` is not used anywhere.

## Coding policy

**Never use Magic Numbers in the code. Set as top of document const variables if used in ONLY that document/component. Otherwise, set in a global constants/config file and import.** (Owner rule, 2026-09-21.)

- Name the constant for what it means and put the unit in the name (`SWIPE_COOLDOWN_MS`, `DRAG_CLICK_SLOP_PX`), with a one-line comment on why it has that value.
- A value shared across files goes in `apps/web/src/lib/constants.ts` for the web app, or `packages/core/src` when the worker needs it too. Add to those rather than starting another.
- Not magic numbers: 0, 1 and -1 used as identities or directions, array indices, and Tailwind classes or design tokens (`gap-3`, `size-14`), which already are the scale.
- Scoring weights and anti-abuse thresholds belong in database config (`app_config`), not in a constants file: the repo is public.

## Hard constraints

- **No bot-detection circumvention** unless the owner explicitly authorizes it: no cloudscraper-class libraries, fingerprint spoofing, UA rotation, proxies or challenge solvers. Every outbound request sends an accurate descriptive `User-Agent` (and `Accept` for Scryfall).
- **Data sources:** the owner's legal team consented (2026-09-21, reaffirmed) to using **all publicly facing data** (no paywall, no login) from every platform, EDHREC and MTGGoldfish included. Consent covers what may be used, not how it is fetched: obey robots.txt, one limiter per host at about one request a second (slower if the host asks, as Archidekt's 429s did), an honest User-Agent, and a 403 or bot challenge switches that source off and is reported to the owner rather than worked around.
  - **Archidekt:** active. Staff allowed the project's API reads (2026-09-14); robots.txt permits `/api/`.
  - **EDHREC:** commander pages fetched and loaded (2026-09-28, T035 slice 11). Individual decklists (`/deckpreview/`) are disallowed by robots.txt and never fetched.
  - **Moxfield:** off. It answered Cloudflare's hard WAF block on a robots.txt-allowed path (2026-09-22) and stays off until it grants an accessible path.
  - **MTGGoldfish:** allowed, not started; its deck downloads are disallowed by robots.txt.
- **Share-link imports** are allowed (owner decision, 2026-09-14): a deck or collection link a user pastes may be fetched, since those links exist to move lists between platforms. One request per user action, honest User-Agent, and on a block show the paste-text fallback; never work around it. The one exception is a large Archidekt collection, whose export is paged: up to 20 requests a second apart, four per server call.
- **Third-party decklists are used for aggregates only and never exposed to visitors.** The one exception is `/admin/crawls` (owner decision, 2026-09-24), which shows a platform admin the crawled corpus, because only the cards prove the adapter read the deck. It is `noindex`, `no-store`, behind the same three locks as the rest of `/admin`, and reads `corpus` through `admin_*` security-definer functions; `corpus` stays off PostgREST's exposed schema list. EDHREC's numbers are likewise never displayed.
- **The repo is public:** anti-abuse thresholds and scoring weights belong in database config, not code.
