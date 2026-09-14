# Status and open backend work (2026-09-14)

Companion to [`execution-plan.md`](execution-plan.md) (the phased roadmap) and [`phase0-report.md`](phase0-report.md). Day-to-day commands and conventions live in the root `CLAUDE.md`.

## Where things stand

| Phase | State |
|---|---|
| 0 — Spike | Passed (go). Open: the blind swap-quality eval (2 raters, 50 cases × 5 commanders, precision@5 + MRR); no rater tool yet. |
| 1 — Data foundation + public pages | Catalog, printings and tag syncs; corpus aggregation; card and commander pages; sitemap, robots, real 404s. Not done: always-on Archidekt crawler with a queue table, precon import, admin (tag kill switch, sync status), typeahead. |
| 2 — Deck tool | Paste or Archidekt link, cuts, adds, swaps, bracket and Game Changer controls, commander deck lookups, rate limits, input schemas, CI with e2e. Not measured: load tests, parser fixture count. |
| 3, 4 | Not started (accounts, collections, votes, saved decks, export). |

## Live setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1` via `apps/web/vercel.json`).
- **Database:** Supabase Free, `us-east-2`. Migrations in `supabase/migrations` are applied by Supabase's GitHub integration when `main` changes; `.github/workflows/db-push.yml` is the manual fallback (secret `DATABASE_URL` = session pooler string).
- **Scryfall data:** `.github/workflows/sync.yml` runs daily (repo variable `SYNC_ENABLED`, secrets `DATABASE_URL`, `WEB_APP_URL`, `REVALIDATE_SECRET`). First load: 34,717 cards, 525,064 printings, 4,533 tags. Each sync refreshes the site's caches.
- **Vercel env:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `RATE_LIMIT_SALT`, `REVALIDATE_SECRET`, `ENABLE_EXPERIMENTAL_COREPACK=1`.

## Open backend items

### 1. Swap candidates time out on the hosted database (highest priority)

- **Symptom:** "Replace this card" in the deck tool shows "Couldn't load replacements" for heavy targets (Vanquish the Horde, Sol Ring, Swords to Plowshares). Card pages for those cards are slow or render without alternatives.
- **Logs:** `Swap candidates failed: canceling statement due to statement timeout` on `POST /api/recs/swap` (503) and `GET /card/<slug>`. Supabase's `anon` role has `statement_timeout = 3s`.
- **Local baseline** (`rec_swap_candidates(target, '{}', identity, true, null, 120)` as `anon`): Sol Ring 414 ms cold / 66 ms warm, Swords to Plowshares 113 ms, Cultivate 79 ms. The function runs with `SET enable_nestloop = off`; the hosted copy has it too.
- **Ruled out:** region latency (functions moved to `cle1`, next to the database; the query itself exceeds 3 s).
- **Suspects:** planner statistics after the bulk load (no explicit `ANALYZE` in the sync jobs); Supabase Free's memory and IO reading `card_tags`, `tag_closure` and `cards`.
- **Check first:** `EXPLAIN (ANALYZE, BUFFERS)` of the call above on the hosted database; `pg_stat_user_tables.last_analyze` / `last_autoanalyze` for `cards`, `card_tags`, `tag_closure`, `printings`.
- **Candidate fixes:** `ANALYZE` after syncs; query or index changes from the plan; `'use cache: remote'` for card page data and swap pools (plain `use cache` doesn't persist across serverless instances, so pages recompute on most visits); a modestly higher `anon` statement timeout as a stopgap.

### 2. Deck play-rate stats aren't on the hosted database

The hosted database has no `commander_keys` / `commander_stats` / `commander_card_stats`, so every commander shows "isn't in our database yet" and adds are thin. The stats come from the Archidekt corpus (third-party decklists), which stays on the owner's machine and must never be committed or uploaded. From that machine: create `apps/worker/.env.hosted` (see `.env.example`), then `yarn workspace @mtg/worker cli:hosted aggregate:corpus`.

### 3. The deck lookup collector isn't running anywhere

The deck tool offers "Pull decks" for commanders without data, but no `serve:commander-requests` worker is running, so requests wait in `commander_requests` and the UI says the collector is offline. It needs the corpus files too, so it runs from the owner's machine (`cli:hosted serve:commander-requests`) until there's another plan.

### 4. Smaller items

- Partner pairs fragment across many pairings (e.g. Rograkh); pairs below `minDecks` borrow solo decks.
- Play rate can lift a weak tag match (Reliquary Tower tops Sea Gate Restoration swaps).
- Invalid commander-pair `commander_keys` rows remain without stats.
- Storage: repeated syncs level off around 346 MB of the 500 MB free tier; commander stats grow with each looked-up commander.
