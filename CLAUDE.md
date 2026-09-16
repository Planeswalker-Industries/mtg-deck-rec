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
- **Writes touch only the rows that change.** Unless a task explicitly asks for a full rebuild, never delete-and-reinsert or update a whole table for a small change. Diff the new rows against the live ones (`is distinct from`, content hashes, `except`) and insert, update or delete only the differences. This applies to sync jobs, aggregates, migrations and one-off fixes alike.
  - Why: every rewritten row leaves a dead row version behind, so a full rewrite of a big table roughly doubles it on disk until vacuum reclaims the space. The hosted database is on a 500 MB free tier.
- **`cards.artist`** is the artist of the representative printing, the same one `images` comes from, so the two always match.
  - It is part of `content_hash` on purpose. The catalog upsert only writes a row when `content_hash` or `rules_hash` differs, so a new column that isn't hashed would stay null forever on existing cards.
  - Adding it therefore rewrote every card row once. Measured cost: `cards` 145 MB → 147 MB, database 356 MB → 358 MB — `cards` has fillfactor 80, so the new row versions mostly fit on the existing pages. Expect the same for any future column added to the hash.
  - Not in `CardSummary`: contract v1 is frozen and only Server Components need it. `CARD_COLUMNS` in `lib/server/cards.ts` selects it onto `CardRow`, and `loadCommanderPage` returns it as `artists` on a superset of the contract's `CommanderPageData`.
- Migrations live in `supabase/migrations`. New `public` tables are not auto-exposed to API roles: every migration must `grant` explicitly (select for `anon`/`authenticated` on public data, all for `service_role`) in addition to RLS policies.
- Tagger data caveats: `weight` is a string (almost always "median") and carries little signal; parent tags can have their own taggings; many broad tags are meta or trivia ("triggered ability", "alliteration"). Tag kill switch (`tags.disabled`) is keyed by UUID and never touched by sync.
- "Does the same job" uses `public.functional_tags`: descendants of the `app_config` allowlist (`functional_tag_roots`) minus descendants of the denylist (`functional_tag_denied_roots`), both stored as tag UUIDs. Tags can have several parents, so the denylist is needed to stop trivia leaking in through a functional parent.
- One `cards` row per oracle card: reprints, alternate art and flavor-named printings are rows in `printings`. Rules-identical cards with different names (Evolving Wilds / Terramorphic Expanse, Universes Beyond renames) stay separate cards, because Commander singleton is by name, and link to a base card via `cards.equivalence_base_id` (grouped by `rules_hash`, which masks the card's own names). `card_stats` collates reprint breadth and the staple score across a twin group.
- **`rec_swap_candidates` and `rec_add_candidates` run with `enable_nestloop = off`** (a function-level SET).
  - Why: their argument-dependent CTEs are estimated at about one row. Nested loops took 3–8 s for swaps on broad removal targets, where hash joins take 0.1–0.3 s. Adds took 1.6–2.7 s, against about 40 ms with hash joins; the same query run outside the function was fast.
  - Any `create or replace` of these functions drops the setting, so repeat the SET.
  - **Both pick their candidate pool out of `cards`, through the covering index `cards_rec_pool`** (`id` include `color_identity`, `game_changer`, `name`, `mana_value`, `equivalence_base_id`, where the row is live, commander-legal and not a basic land). `cards` is 121 MB of heap and the hash join swept all of it: one add touched ~142 MB, one swap ~165 MB, against 224 MB of `shared_buffers` on the hosted free tier. Warm that still ran in 90–160 ms, but any eviction (the next call, a sync, an idle spell) made it read from disk and blow past the anon 3 s timeout. With the index: add ~22 MB, swap ~46 MB. Keep the index's columns and predicate in step with what the two `eligible`/`pool` CTEs read and filter on; the price update never writes these columns, so `cards` keeps its HOT updates.
  - Exclusive tag modes (`app_config.functional_tag_exclusive_groups`, currently sweeper vs spot removal) multiply tag similarity by `penalty` when a candidate has only a mode the target lacks.
- `rec_swap_candidates` selects its candidate pool with SQL weights that mirror `SWAP_WEIGHTS` in `@mtg/core/scoring` (no-corpus case). Change both together.
- **Deck corpus:** only aggregates live in Postgres; third-party decklists stay in local JSONL files.
  - **Shared filters:** `apps/worker/src/lib/corpus.ts` (`resolveDeck`) decides which decks count, for both `aggregate:corpus` and the stability job.
  - **Stored stats:** `card_global_stats.rate` is the baseline p0, computed over decks whose identity allows the card. `commander_card_stats` holds inclusion shrunk toward p0, (x + α·p0)/(n + α), and synergy = shrunk − p0.
  - **Settings:** `app_config.corpus` holds `shrinkAlpha`, `minDecks` (50) and `fullDecks` (100), measured by `spike:corpus:stability`, and `partnerPoolWeight` (0.25).
  - **Web side:** `apps/web/src/lib/server/corpus.ts` loads every commander key that shares one of a deck's commanders; `pickCorpusSources` (`@mtg/core/scoring`) decides which count.
    - A key with `minDecks` decks of its own stands alone. Below that, every other key led by one of its commanders (a partner's solo decks, its other pairings; Rograkh has 25) is borrowed at `partnerPoolWeight` per deck.
    - A card's eligible decks count only sources whose colors allow it. Confidence uses own plus weighted borrowed decks and never reaches `full` while borrowing.
    - `CommanderKeyRef.deckCount` counts only decks with exactly those commanders; `borrowedDeckCount` holds the rest, and `CorpusEvidence.pooled` marks weighted counts. Commander pages need decks of their own.
    - Why 0.25: leaving each pair's own decks out, borrowed decks matched the pair's own top 50 for 47 cards across four pairs, against 29 for colors-only rates. Every pair measured includes Rograkh; retune when more pair data exists.
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
- **Share-link fetches and the kill switch:** every deck or collection link import goes through `fetchShareLink` (`lib/server/share-import.ts`).
  - It only fetches URLs the app builds for that source's own hosts, never follows redirects, and sends the honest User-Agent.
  - `classifyShareResponse` (`@mtg/core/parse`) decides what came back. A Cloudflare challenge, or a 403/409 outside the site's usual format, switches that source off in `share_import_sources` (via `SUPABASE_SECRET_KEY`, `lib/server/supabase-admin.ts`) and writes an `audit_log` row. A 403 in the usual format just means the list isn't public.
  - A switched-off source makes no requests until someone deliberately sets `enabled` back to true. `yarn workspace @mtg/web tsx --env-file=.env.local scripts/share-kill-switch-check.ts` checks this with a faked fetch.
- **Accounts (email code + Google):**
  - `/sign-in` sends a 6-digit code and a link by email (`sendSignInEmailAction` → `signInWithOtp`; template `supabase/templates/sign-in.html`). The code is checked by `verifySignInCodeAction`; the link goes to `/auth/confirm`, which verifies a token hash, so it works on any device. Google goes through `startGoogleSignInAction` → `/auth/callback` and only shows with `NEXT_PUBLIC_AUTH_GOOGLE=1` (config in `supabase/config.toml` `[auth.external.google]`, off until credentials exist).
  - `lib/server/auth.ts` `createAuthClient()` (`@supabase/ssr`, cookies) and `getCurrentUser()` (uncached, behind `<Suspense>`). `proxy.ts` refreshes the session only when an `sb-*-auth-token` cookie is present. Redirect targets go through `safeNextPath` (`lib/safe-path.ts`).
  - `public.profiles` gets a row per new user via the `on_auth_user_created` trigger. Sign-in attempts use the `auth` rate-limit bucket.
  - The email link is `{{ .RedirectTo }}&token_hash=...`: `sendSignInEmailAction` always passes `/auth/confirm?next=...` as the redirect, so the template appends with `&`. That redirect must be on the Auth redirect allow list (`additional_redirect_urls` locally, the dashboard for a hosted project); otherwise Supabase falls back to the site URL and the link breaks.
  - Locally, sign-in emails land in Mailpit (http://127.0.0.1:56324); `E2E_MAILPIT_URL=http://127.0.0.1:56324` enables `e2e/sign-in.spec.ts` and `e2e/account-collection.spec.ts`. After editing auth settings in `config.toml`, run `supabase stop && supabase start`.
- **Collections (browser or account) and owned-only mode:**
  - `/collection` (`components/collection/collection-tool.tsx`) parses pasted text in the browser and matches it 2,000 rows per call. Signed out, the result stays in IndexedDB for 7 days (`lib/collection-store.ts`; localStorage can't hold large collections). Signed in, it replaces the account's collection through `saveCollectionBatchAction` (`app/collection/actions.ts`).
  - Account storage (migration `20260914002400_account_collections.sql`): `collection_items` (one row per card, printing or none, finish, condition and language), staged `collection_import_rows`, and `collection_imports`. Signed-in users can only read and delete their own rows directly. Writes go through the security-definer functions `start_collection_import`, `save_collection_rows` and `commit_collection_import`, which act on `auth.uid()` only and apply `app_config.collections` (`maxImportRows`, `maxEntries`, `maxOpenImports`). Nothing changes until commit; merge adds quantities, replace swaps the collection.
  - `useCollectionSource` (`components/collection/use-collection-source.ts`) tells the deck tool and the collection page where the collection is (none, browser, account), from IndexedDB plus `getAccountCollectionAction`. A browser collection wins while it waits to move.
  - Right after sign-in, `AccountCollectionSync` (rendered by the header's `AccountLink` for signed-in visitors) merges a browser collection into the account, clears the browser copy and calls `notifyCollectionChanged()`. A Web Lock stops two tabs from moving it twice; a failed move keeps both copies and retries on the next page load.
  - The "Only cards I own" switch (remembered in localStorage) sends `ownership: { kind: "session", ownedCardIds }` for a browser collection, or `{ kind: "account" }`, which `handleRecsRequest` replaces with the signed-in user's `my_owned_card_ids()` (UNAUTHENTICATED when signed out). The recs code applies owned-only adds and swaps, NOT_OWNED cuts and owned badges. Swaps with ownership skip the swap-pool cache.
- **Collection matching:** `parseCollectionText` reads pasted exports; `resolveCollectionRowsAction` matches up to 2,000 rows per call through `resolve_collection_rows` (Scryfall id, TCGplayer id, set + number + language, set + number, then name) and returns `catalog_epoch()`. `scripts/collection-resolve-check.ts` checks it against the local database.
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
- **Swap votes (swipe rater, slice 1):**
  - `castVoteAction` (`app/deck/actions.ts`) → `cast_swap_vote` records, changes or clears (value 0) a vote on a (target, replacement) pair in `public.swap_votes`, and returns the pair's Bayesian summary (prior in `app_config.votes`). A repeated identical vote writes nothing.
  - Each vote keeps what the voter saw (`VoteContext`: deck tool or standalone rater, sitting id, position, candidates shown, matched tags). Slice 5 will weigh votes per shared tag and against candidates declined beside an accepted one; nothing reads votes for scoring yet.
  - Anyone can vote until OAuth ships. The action uses `createAuthClient`, so a signed-in vote is keyed to `auth.uid()`; everyone else by the salted visitor hash (people behind one address share it). Rate limit bucket `vote`.
- **Rate limits and input validation:**
  - `@mtg/core/schemas` (`contract/schemas.ts`) holds zod schemas for every network input; `parseInput` maps oversized text/lists to PAYLOAD_TOO_LARGE, other problems to VALIDATION (first message plus `fieldErrors`).
  - `public.hit_rate_limit(bucket, visitor)` counts fixed windows in `rate_limit_hits`; budgets per bucket (`recs`, `deck`, `import`, `lookup`, `collection`, `auth`, `vote`, `search`) live in `app_config.rate_limits`. `lib/server/rate-limit.ts` fails open if the check errors.
  - The recs routes share `handleRecsRequest` (`lib/server/recs-route.ts`): rate limit, validate, turn an account collection into the signed-in user's owned card ids, run, map errors to status codes (429 with `Retry-After`). Server actions use `begin(bucket)` in `app/deck/actions.ts`. Visitor keys come from `lib/server/visitor.ts`.
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
- Cards to add: `rec_add_candidates` orders its pool by the same corpus score as `commanderCorpusScore` (√baseline without commander decks), over the corpus sources with their weights (`p_key_weights`) and per-key color identity, like `loadCardCorpus`. The older `p_deck_count` overload stays until deployed apps stop calling it. Commander pages that borrow decks use the same function for their top cards; the rest read `commander_card_stats` by index, because the function hit the 3 s `anon` statement timeout on a cold hosted database right after the release. The app re-scores with `ADD_WEIGHTS` (corpus 0.8, role gap 0.2) and groups by `cardCategory`. Change both together. Cuts use commander play rates only at or above `minDecks`: `LOW_SYNERGY` below 0.35, and cards scoring ≥ 0.5 aren't flagged for cost or role overlap (generic role targets undercount what some commanders run).
- **Storage budget (free hosted tier, 500 MB):**
  - Compacted, the database is about 280 MB. Printings (all paper languages) are the biggest table.
  - Syncs must not rewrite unchanged rows: an update writes a new row version, so rewriting every row each run left tables at roughly twice their live size (561 MB before compaction). The three Scryfall syncs, `rebuild_tag_closure()` and `aggregate:corpus` compute their results in temp tables and write only rows that differ.
  - `printings.prices_as_of` and `cards.prices_as_of` mean when a price last changed. Pages show `prices_checked_at()` (the newest successful catalog or printings sync) as the as-of date, applied in `fetchCardsById`.
  - Tolerances: `aggregate:corpus` skips shrunk inclusion and synergy moves under 0.001, and the tag sync skips idf moves under 0.0001.
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

- Mobile-first is the top priority, and every card shown must show its image. Design direction is **"Table at night"**: the page is a dark table lit by one warm source above it. Tokens live in `apps/web/src/app/globals.css`; fonts are Atkinson Hyperlegible Next (UI/body, kept for small-size legibility on phones) and Fraunces (headings, `font-heading`).
  - The site is dark by default: `:root` holds the dark values and `<html>` carries `dark`, so shadcn's `dark:` variants apply. There is no light theme.
  - `--primary` (gold) is the light, so it marks the one action that matters on a screen, not every link. Nav links are `text-muted-foreground` until hovered.
  - Light falls from the top: the `lit` utility gives a surface a warm top edge and a shadow below. No outer glows on hover, and no gradient used as decoration — the hero's radial sits behind the card fan because it is what lights it.
  - `--cut` (rose), `--add` (jade) and `--replace` (violet) name the three jobs. They are deliberately off the mana wheel: `--color-mana-*` stays reserved for color identity, so a role pill can never be mistaken for a mana color.
- **Swipe view** (swipe rater slice 2; `components/deck/swipe-rater.tsx`, `use-swipe-rater.ts`):
  - The card to cut sits on top; the replacement sits below between a ❌ button (left) and a ✅ button (right) that never overlap a card.
  - Right swipe, ✅ or → votes +1 and picks the swap; left swipe, ❌ or ← votes −1 and shows the next replacement. Every vote carries `VoteContext`.
  - Picked swaps go into the decklist (`useDeckTool.applySwaps`, which edits the player's own lines) when the sitting ends or the view changes.
  - Drag, flick and fling use Motion (`motion/react`, pinned).
  - Swipe is the default view on a first visit; the Swipe/List choice is remembered in localStorage (`lib/review-view.ts`). e2e tests that need the tabs click List first.
  - While the deck is read and cuts or the first replacements load, `ShuffleDeck` shuffles card backs (`CardBack`: `public/card_lg.png` through `next/image`, cropped to card proportions; the shuffling deck loads them eagerly, since lazy backs start as empty outlines) in the middle of a dimmed, fixed layer over the page, so nothing underneath can be tapped while the database works. The first pair of a sitting is drawn from it (`DrawnCard`: slide out and flip); later cards just appear. Reduced motion shows a still stack and no draw.
  - Both cards are wrapped in `ZoomableCard` (`components/cards/card-zoom.tsx`): a mouse resting on one opens it enlarged after 450 ms, a click or tap opens it at once.
    - The enlarged card renders through a **portal into `document.body`**. A transformed ancestor (the swipe and draw animations) would otherwise make its `fixed` layer cover only the card, and a dismissing tap would land on the buttons underneath.
    - A hover-opened layer is `pointer-events-none`, or covering the card would fire `pointerleave` and close it again at once. A click- or tap-opened one is solid, closes on the click (never on pointerdown, whose click would then go to whatever was below), and swallows arrow keys so the swipe view can't vote while it's up.
    - Swipes don't open it: `SwipeCard` suppresses the click a drag ends with, and a card ignores a click within 400 ms of a dismissal.
  - The jobs both cards do show as pills (`TagPills`): the target's wording flanks its image left and right, the replacement's sits under its name.
- **Card rater** (`/rate`, swipe rater slice 4; `components/rater/`):
  - The player picks a commander by name (`CommanderPicker` → `GET /api/cards/search` → SQL `search_cards`: prefix, then contains, then trigram typos, more-played commanders first; rate limit bucket `search`), or arrives from a commander page at `/rate?commander=<slug>`.
  - `dealRaterCardsAction` deals what the commander's decks play (`rec_add_candidates`, borrowing partner decks like the deck tool), or cards widely played in its colors when it has no decks. Lands are left out. Rounds of 10 cards.
  - `SwipeRater mode="rater"`: a card's top 6 replacements come shuffled with our ranking hidden (honest data for the swap-quality eval), every swipe rates one (votes with source `rater`), and the next card comes up once all are rated.
- **`components/cards/art-backdrop.tsx`** puts a card's art crop behind a page header. An art crop carries no artist or copyright line of its own (unlike a full card image, where the line is part of the picture), so the credit is rendered beneath it and links to the card page. **With no `artist` the art isn't shown at all** — uncredited art is worse than none.
  - Its two dimming layers multiply: keep the combined alpha near 0.7 behind text. Two heavy layers reach ~0.93 and the art stops reading.
  - Used on the commander page header and the card page header. The landing hero has its own copy of the treatment, because it needs a horizontal wash (the headline sits left, the cards right) and its credit goes below the fold of the section.
  - **The landing page's art is the one database read on that page**, so it is wrapped in `<Suspense fallback={null}>` and `getHeroArt` returns null on any error. The page renders without a backdrop rather than failing; checked by pointing `HERO_SLUG` at a missing card (200, headline intact, no credit, no server error). Keep it that way — the landing page should not be able to break when the database is down.
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
- Data sources qualify only by documented API, published terms, or direct operator permission. Do not add Deckstats, Aetherhub, MTGGoldfish, TappedOut, or EDHREC `json.edhrec.com`. Background crawling of Moxfield still needs its authorization.
- Share-link imports are allowed (owner decision, 2026-09-14): a deck or collection link a user pastes from Archidekt, ManaBox, Moxfield, TCGplayer or similar sites may be fetched, since those links exist to move lists between platforms. One request per user action, honest User-Agent, and if the site blocks automated requests (bot challenge, 403) show the paste-text fallback; never work around it.
- Third-party decklists are used for aggregates only and never exposed.
- The repo is public: anti-abuse thresholds and scoring weights belong in database config, not code.
