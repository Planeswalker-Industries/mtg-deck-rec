# Testing

SQL checks, e2e and regression runs, CI, local test accounts and the web check scripts. Back to [`CLAUDE.md`](../../CLAUDE.md).

## Test commands

```sh
docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres -q < supabase/tests/<file>.sql   # SQL checks, each rolls back:
#   saved-decks.sql          saved-deck functions and isolation (needs the local catalog)
#   deck-snapshots.sql       deck originals: written once, owner-only, readable when the deck is
#   collection-editing.sql   hand edits: card totals over printing entries, own collection only
#   collection-mode.sql      decks marked built, my_card_availability (own copies and built decks only), a collection's pool (needs the local catalog)
#   card-search.sql          deckbuilder search: colours, types, mana value, paging (needs the local catalog)
#   bracket-rules.sql        app_config.brackets, bracket_cards(), serving_deck_combos: complete and one-short combos, commander pieces, filters (needs the local catalog and Spellbook)
#   platform-admins.sql      platform admin guard and user management
#   admin-crawled-decks.sql  /admin/crawls functions: admin-only reads of the raw crawled decks
#   edhrec-stats.sql         EDHREC tables, resolved (corpus.edhrec_*) and raw (edhrec.*): no API role reads them, constraints, cascade (needs the local catalog)
#   crawl-commanders.sql     per-commander crawl queue and raw deck writes: diff-only seed, queue order, visit stamps, service_role only (needs the local catalog)
#   data-layers.sql          the private schemas, the source-naming rule, one deck id across sources, crawl.decks, corpus.decks rules (needs the local catalog)
#   collator.sql             corpus.decks queues dirty commanders (a player's own delete included), corpus.spellbook_combos, collate_state, settings (needs the local catalog)
#   vps-worker.sql           a requested commander comes first in the crawl's queue (and joins it), the worker's schedule (needs the local catalog)
#   spellbook.sql            raw Spellbook combos: kept as published, constraints, no API role reads them
#   serving.sql              the serving tables and reads: API access, the deck's filters in the old functions' order, the stored similarity, typical_deck_profile (needs the local catalog)
#   pairs.sql                card pairs and serving_deck_affinity: the pairs touching a deck, card weights, neighbours, no API access to the tables (needs the local catalog)
#   rec-events.sql           record_rec_event: keying, checks, re-keying on account deletion; admin_rec_accept_rates (admins only)
#   build.sql                serving_build_pool: the pools, pairs among their cards, combos, basic lands; app_config.scoring.build (needs the local catalog and corpus)
docker exec -i supabase_db_mtg_deck_rec psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/tests/collection-import.sql # rollback-only diff imports, provenance/row versions, normalization, limits and isolation; assertion failures exit nonzero
docker exec -i supabase_db_mtg_deck_rec psql -U postgres -d postgres -q < supabase/demo/admin-demo.sql   # demo accounts, decks and collections for /admin (commits; re-runnable)

yarn workspace @mtg/web e2e                      # Playwright (apps/web/e2e) on a production build at :3300 (runs `next start`, so `build` first or it tests a stale bundle); E2E_BASE_URL=http://localhost:3100 to reuse a running server (installed Chrome), E2E_LOCAL_DATA=1 when it has the real catalog and corpus
yarn workspace @mtg/web regress [dir]            # recommendation regression fixtures (JSON in [dir], default $MTG_DATA_DIR/regression; local DB) → pass/FAIL per check
```

CI (`.github/workflows/ci.yml`, pushes to main, develop and `phase*/**`, PRs): install, typecheck, lint, unit tests, then `supabase start` on an empty database (proves migrations apply from scratch), a build with `NEXT_PUBLIC_USE_MOCKS=1`, and the e2e suite. It fails a PR that reuses a migration version. Checks that need the real catalog, corpus or user decklists (regression harness, `E2E_LOCAL_DATA` tests, the machine's own tool scripts) stay local: third-party decklists can't be public.

**Local test accounts:** `supabase/seed.sql` creates `anon@test.local` and `admin@test.local` on `supabase db reset`; the admin one is in `public.platform_admins`, the other deliberately is not. Sign in with `yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts anon` (run from `apps/web/`), which mints a link directly and costs none of the local email budget. It also takes a plain email address (the `@demo.local` cast from `admin-demo.sql`) and checks the account exists first, because `generateLink` **creates** an unknown one. The seed raises the local `auth` rate-limit budget, since every e2e sign-in comes from one address. `seed.sql` opens with a guard that raises if `auth.users` holds any other account, so it only runs on a fresh reset and never on hosted.

## Check scripts

Run with `yarn workspace @mtg/web tsx [--env-file=.env.local] scripts/<name>.ts`.

| Script | Checks | Needs |
|---|---|---|
| `retry-timeout-check.ts` | Statement-timeout retry | nothing (faked) |
| `search-index-check.ts` | The app survives a missing, slow or broken index | nothing (faked) |
| `archidekt-cron-check.ts`, `moxfield-cron-check.ts` | Cron route: `CRON_SECRET` gate, spoofed headers refused, forwarded POST | nothing (faked) |
| `share-kill-switch-check.ts` | A challenge switches the source off with an audit row | local database |
| `collection-resolve-check.ts` | Collection matching, including a batch past the row cap | local database |
| `search-parity-check.ts` | The index agrees with Postgres | local database and index |
| `rec-regress.ts` (`yarn workspace @mtg/web regress [dir]`) | Recommendation fixtures | local database; fixture files in `[dir]` or `$MTG_DATA_DIR/regression`, never in the repo |
| `dev-sign-in.ts` | Prints a sign-in link for a local account | local database |
| `build-featured-decks.ts` | Regenerates the featured-decks fixture | local catalog and corpus |
