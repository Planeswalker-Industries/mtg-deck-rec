# CLAUDE.md

mtg-deck-rec: a public, Commander-only web app. Paste or import a decklist and get cards to add, cards to cut and functional substitutes, with estimated prices. It works without a collection (ranked by corpus play rate and Scryfall Tagger tags) and with one (the player's collection filters or reorders the candidates).

Live at https://mtg-app-psi.vercel.app. Open work: [`docs/tasks_open.md`](docs/tasks_open.md). When code and this file disagree, the code wins and this file is fixed.

- **Repo:** `Planeswalker-Industries/mtg-deck-rec`, public. User-Agent strings, in-app links and the search API's Go module path use that address.
- **Branches:** start every branch from `develop` and open PRs with `--base develop`. `main` is merged from `develop` by the owner; it is what Vercel production and the Supabase GitHub integration deploy.

## Commands

Yarn 4 workspaces (`nodeLinker: node-modules`), Node ≥ 24. TypeScript is pinned to 6.0.x: TS 7 doesn't ship the JS compiler API that typescript-eslint needs.

```sh
yarn install
yarn dev                                         # apps/web on :3000 against local Supabase (NEXT_PUBLIC_USE_MOCKS=1 for mocks)
yarn typecheck | yarn lint | yarn test | yarn build   # all workspaces
yarn workspace @mtg/web typecheck                # next typegen + tsc
yarn workspace @mtg/core vitest run <file> | -t "<name>"

supabase start                                   # API 56321, Postgres 56322, Studio 56323, Mailpit 56324
supabase db reset                                # re-apply migrations from scratch (seeds anon@test.local and admin@test.local)
supabase migration up                            # apply new migrations locally
supabase gen types typescript --local            # → apps/web/src/lib/server/database.types.ts (UTF-8 without BOM, LF)
docker exec -i supabase_db_mtg_deck_rec psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/tests/<file>.sql   # SQL checks; each rolls back

yarn workspace @mtg/web e2e [spec]               # Playwright on a production build at :3300: build first. E2E_LOCAL_DATA=1 with the real catalog, E2E_MAILPIT_URL=http://127.0.0.1:56324 for sign-in tests
yarn workspace @mtg/web regress [dir]            # recommendation fixtures (default $MTG_DATA_DIR/regression; never in the repo)
yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts anon   # from apps/web: sign-in link for a local account

yarn workspace @mtg/worker cli <job>             # bulk:download, sync:catalog, sync:printings, sync:tags, sync:spellbook, sync:edhrec, sync:typesense [--rebuild], collate, aggregate:corpus, precompute, eval:holdout, serve
yarn workspace @mtg/worker cli:hosted <job>      # the same against hosted (apps/worker/.env.hosted); plain `cli` is always local

docker compose -f docker-compose.search.yml up -d --build   # local Typesense (56325) and search API (56326)
cd services/search-api && go test ./...
```

psql isn't installed locally; use the `docker exec` form above. CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, migrations on an empty database, a mock build and e2e. Anything needing the real catalog, corpus or third-party decklists stays local.

## Architecture

- `packages/core/src/contract/` is the frontend/backend contract and the source of truth for API shapes. The web app reaches it only through `getApis()` (`apps/web/src/lib/api/client.ts`): real actions and routes, or `createMockApis()` with `NEXT_PUBLIC_USE_MOCKS=1`. A contract change bumps `CONTRACT_VERSION` (`contract/version.ts`, changelog comment per version) and needs frontend and backend approval.
- `packages/core` also holds the pure, tested logic shared by the app, the worker and the evaluation: `formats/commander/`, `parse/`, `scoring/`, `journey/`, `collection/`, `search/`.
- `apps/web`: Next.js 16.3 on Vercel (functions in `cle1`, next to the database in `us-east-2`).
- `apps/worker`: tsx CLI for syncs, collation and the precompute worker; `cli serve` runs on the VPS on the `app_config.worker` schedule.
- `services/search-api`: Go (Fiber) on the VPS. The only client of Typesense and the host of the daily deck crawl.
- **Data layers:** raw private schema per source (`archidekt`, `moxfield`, `edhrec`, `spellbook`) → `corpus` (written only by `cli collate`) → `public` serving tables (written only by the precompute worker or `aggregate:corpus`). Each layer reads only the one before it; none of the private schemas is exposed to PostgREST.
- **Requests score nothing in SQL.** Recommendations read the serving tables through the `serving_*` functions in one round, then rank in TypeScript (`@mtg/core/scoring` `rank.ts`). A new input goes into those functions or the cached settings, never into a read ahead of them.
- **The search index is an optimisation, never a dependency.** `fromIndex` falls back to Postgres when the index is unset, slow or broken. A new index field needs `sync:typesense --rebuild`. Recommendations, collection matching and anything a user owns stay in Postgres.

## Rules

### Database

- **Writes touch only the rows that change.** Diff against the live rows (`is distinct from`, content hashes) and write only the differences; never delete-and-reinsert or rewrite a table for a small change. Merge with `update … from` the changed staged rows, then `insert` the new ones. No materialized views.
- **Every migration grants explicitly** to the API roles (select for `anon`/`authenticated` on public data, execute only where needed), besides RLS. User writes go through security-definer functions keyed on `auth.uid()`.
- A new catalog column the upsert fills goes into `content_hash`, or existing rows never get it.
- Postgres functions take at most 100 arguments: build long lists with `ARRAY[...]`.
- Jobs reserve their connection through `reserve` (`apps/worker/src/lib/db.ts`), which raises the statement timeout for that session; hosted stops statements after 2 minutes. Hosted jobs use the Supabase session pooler, never the transaction pooler (they need temp tables).
- Functions that `SET enable_nestloop` must repeat the SET on every `create or replace`.
- Release: merging a migration to `develop` publishes a Vercel preview that still runs against `main`'s schema. After a release to `main`, confirm hosted `supabase_migrations.schema_migrations` reached the newest version; `db-push.yml` is the fallback.
- Single-value jsonb or array returns (`my_collection_entries`, `my_owned_card_ids`, `serving_build_pool`) exist so PostgREST's row cap can't truncate them; clamp what anonymous callers may ask for (`app_config.serving_limits`).

### Accounts and data

- **Never test account deletion**, locally or hosted: no script or test calls `delete_my_account`.
- New decks are public, so a deck is only created when the player explicitly saves. `listMyDecks` must filter by `user_id` explicitly (RLS alone would list every public deck). Saving a deck never changes the collection.
- Hiding a deck does not remove it from the aggregates; the visibility control and `/privacy` must say so.
- Deck URLs carry `decks.code` (random), never anything derived from the name.
- Every network input is validated by the zod schemas in `@mtg/core/schemas`. Rate limits live in `app_config.rate_limits`; the visitor key is a salted hash of the first `x-forwarded-for` address.
- Every scoring change goes through `cli eval:holdout` and its gate; a new score component ships at weight 0 until it passes.

### Web (Next.js 16.3)

APIs differ from older versions. Read `node_modules/next/dist/docs/` before writing Next code.

- `cacheComponents: true`: request-time reads (`useSearchParams`, `params`, cookies) sit inside `<Suspense>`. Pair every `use cache` with `cacheLife`. `revalidateTag` takes a profile argument. `proxy.ts` replaces `middleware.ts`. `export const dynamic` is a build error only `build` catches.
- `notFound()` or `redirect()` inside `<Suspense>` runs after the shell streamed (200, or a stranded loading page). Real 404s and redirects happen in `proxy.ts`.
- Recommendations are Route Handlers (`POST /api/recs/{swap,add,cut,build}`) because Server Actions dispatch serially; everything else is a Server Action. Keep `next/cache` imports out of `lib/server/recs.ts` and `serving.ts` so `regress` runs outside Next.
- Cron routes are authorized by `CRON_SECRET` only, never by `x-vercel-cron-schedule` or the user agent.
- Production builds need a reachable Supabase (`next build` prerenders `/sitemap.xml`). Keep build-time prerendering away from queries that grow with the catalog.

### UI

- Mobile-first and dark only. Every card shown shows its image. Tokens are in `apps/web/src/app/globals.css`: `--primary` (blue) is the one accent, on actions, links, focus and the selected state only. Blue means pressable, and everything pressable shows blue at rest, not only on hover: primary buttons are solid blue, `outline` buttons a blue border and text, `ghost` and icon buttons blue text, unselected toggles and pills blue text (`TOGGLE_OFF`/`PILL_OFF` in `lib/constants.ts`), selected ones solid blue. The exceptions: Delete and Remove are red (`destructive`), and a swipe's accept button keeps its job's colour (cut red, add green).
- Status colours are never blue: red (`--destructive`, `--cut`) for errors, over-target counts and cuts, green (`--success`, `--add`) for good and adds, amber (`--warning`) for warnings. Progress bars are ink. `--cut`, `--add`, `--replace` and every status colour always come with an icon and a label; one-line errors use `ErrorText`.
- Fonts: Bricolage Grotesque (400 and 600 only) for UI, Newsreader Italic (`font-drama`) for the buddy's voice only, DM Mono (`font-mono`, 400 only) for standalone numbers. Type scale `text-xs`–`text-4xl`; no arbitrary `text-[…]`. Touch targets at least 44 px on phones.
- Card images are hotlinked from Scryfall `unoptimized`: pick the `variant` from the rendered size (`small` for every grid). Never cover the lower part of a card: the artist and copyright line must stay visible.
- On a phone at 390×844, the swipe view's ✓ and ✕ stay on screen without scrolling; re-measure after adding anything above the swipe card or changing the Deck stats footer.
- Prices always render with their as-of date. Low play rate reads as "rarely played with this commander", never as wrong.

## Domain conventions

- `CardId` is an int surrogate 1:1 with Scryfall `oracle_id`. Decks and recommendations are oracle-level; collections are printing-level (`PrintingId` = Scryfall card id). Printings are English only.
- Rules-identical cards with different names stay separate cards (singleton is by name), linked through `cards.equivalence_base_id`.
- Tagger tags are keyed by UUID, never slug or label. Bulk data holds only direct taggings; parents come through the hierarchy.
- A card's release month comes from `card_stats.first_printed_at`, never `cards.released_at`.
- Scryfall `edhrec_rank` is not used anywhere.

## Coding policy

**No magic numbers.** A value used in one file is a named const at the top of that file; a value shared across files goes in `apps/web/src/lib/constants.ts` (web) or `packages/core/src` (shared with the worker).

- Name the constant for what it means, unit in the name (`SWIPE_COOLDOWN_MS`), with a one-line comment on why it has that value.
- Not magic numbers: 0, 1 and -1 as identities or directions, array indices, Tailwind classes and design tokens.
- Scoring weights and anti-abuse thresholds belong in `app_config`, not in code: the repo is public.

## Hard constraints

- **No bot-detection circumvention:** no cloudscraper-class libraries, fingerprint spoofing, UA rotation, proxies or challenge solvers. Every outbound request sends an accurate, descriptive `User-Agent` (and `Accept` for Scryfall).
- **Fetching public data:** obey robots.txt, one limiter per host at about one request a second (slower if the host pushes back), an honest User-Agent. A 403 or bot challenge switches that source off and is reported to the owner, never worked around.
  - **Archidekt:** active, through the Go crawl's adapter only (staff allowed API reads).
  - **EDHREC:** commander pages as JSON (`sync:edhrec`). Individual decklists (`/deckpreview/`) are never fetched.
  - **Commander Spellbook:** only the daily export on `json.commanderspellbook.com`. Never call `backend.commanderspellbook.com`.
  - **Moxfield:** off (Cloudflare block). **MTGGoldfish:** allowed, not started; its deck downloads are disallowed.
- **Share-link imports:** a deck or collection link a user pastes may be fetched, one request per user action (a large Archidekt collection's paged export excepted: up to 20 requests a second apart, four per server call). On a block, show the paste-text fallback.
- **Third-party decklists are used for aggregates only and never shown to visitors.** The one exception is `/admin/crawls`, for platform admins, `noindex` and `no-store`, read through `admin_*` security-definer functions. EDHREC's numbers and Spellbook's popularity are never displayed. Credit Archidekt and Commander Spellbook with a link wherever their data shows.

## Local data

Large local data (Scryfall bulk files, regression fixtures, screenshots) goes under the folder `MTG_DATA_DIR` names; unset, the worker uses the system temp directory. Anything particular to one machine goes in `CLAUDE.local.md` (gitignored).
