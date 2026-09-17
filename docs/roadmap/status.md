# Status and open work (2026-09-17)

Companion to [`execution-plan.md`](execution-plan.md) (the phased roadmap) and [`phase0-report.md`](phase0-report.md). Day-to-day commands and conventions live in the root `CLAUDE.md`.

## Where things stand

| Phase | State |
|---|---|
| 0 — Spike | Passed (go). **Open: the blind swap-quality eval** (2 raters, 50 cases × 5 commanders, precision@5 + MRR). `/rate` is built and waiting; the gate needs two humans, not more code. |
| 1 — Data foundation + public pages | Catalog, printings and tag syncs; corpus aggregation; card and commander pages; header search; sitemap, robots, real 404s. Not done: always-on Archidekt crawler with a queue table, precon import, admin pages (tag kill switch, sync status). |
| 2 — Deck tool | Paste or Archidekt link, cuts, adds, swaps, bracket and Game Changer controls, commander deck lookups, rate limits, input schemas, CI with e2e. The workspace layout landed: Cut/Add/Replace as a drill-down on a phone and a rail on a wide screen, a section nav over the deck's own groups, and each job's top suggestion in the rail. Not measured: k6 load targets, parser fixture count. |
| 3 — Accounts and collections | Email-code and link sign-in (Google wired, off until credentials exist); pasted collection imports in the browser or on the account; browser collection moves to the account after sign-in; owned-only suggestions. Not done: collection imports from share links, CSV file import in a Web Worker, pgTAP tests, the 10k-row timing check. |
| 4 — Votes, saved decks, export | Partly built, ahead of the plan's order. Saved decks have schema, write functions, contract v9, `/decks` list, `/decks/[commander]/[code]`, and reopening in the tool with auto-save. Votes are recorded with full context but **nothing reads them for scoring**. Not started: export, favorites. |

## Live setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`).
- **Database:** Supabase Free, `us-east-2`, **372 MB of 500 MB**. Migrations in `supabase/migrations` are applied by Supabase's GitHub integration when **`main`** changes; `.github/workflows/db-push.yml` is the manual fallback.
- **Scryfall data:** `.github/workflows/sync.yml` runs daily (repo variable `SYNC_ENABLED`, currently `true`). Catalog 34,765 cards, 525k printings.
- **Corpus on hosted:** 129 commanders have stats. Aggregates are rebuilt from this PC with `cli:hosted aggregate:corpus`.

## Open work

### 1. The deck lookup collector isn't running anywhere

The deck tool offers "Pull decks" for commanders without data, but no `serve:commander-requests` worker is running, so requests wait in `commander_requests` and the UI reports the collector offline. It needs the corpus files, so it runs from this PC (`cli:hosted serve:commander-requests`) until there is another plan.

### 2. Swap timeouts on the hosted database — mitigated, watch it

Was the top item. Two changes shipped:

- `cards_rec_pool` covering index, so the recommendation functions stop sweeping the whole `cards` heap.
- `retryOnTimeout` on all four recommendation call sites, retrying up to three attempts but only on SQLSTATE 57014, plus `public.rec_timeouts` recording the queries that exhaust their retries.

Measured on hosted before the retry landed (Sol Ring, WUBRG, limit 120): first call cancelled at 3.0 s, second 2.02 s, third 0.27 s — cold `shared_buffers`, warming as it goes.

**Still a mitigation, not a fix.** The real fix is caching the swap pool somewhere that survives between serverless instances; plain `use cache` does not. Check `rec_timeouts` for which cards still exhaust their retries:

```sql
select t.fn, c.name, t.commander_ids, t.hits, t.last_seen
from public.rec_timeouts t left join public.cards c on c.id = t.target_card_id
order by t.hits desc limit 20;
```

### 3. Smaller items

- **`collections.maxEntries` is 100,000**, about 23 MB per account. Six maxed accounts would exhaust the free tier's headroom. It lives in `app_config.collections`, so lowering it is a SQL update with no deploy.
- **`artist` is not populated on hosted** yet, so no art backdrops render there. The column shipped after the last sync; the next daily run fills it, because `artist` is part of `content_hash`. `cli:hosted sync:catalog --force` does it sooner.
- `partnerPoolWeight` 0.25 rests on four pairs, all including Rograkh. Retune once more pair decks or the swap-quality eval exist.
- Play rate can lift a weak tag match (Reliquary Tower tops Sea Gate Restoration swaps).
- Invalid commander-pair `commander_keys` rows remain without stats.
- Parser tests hold 26 cases against a Phase 2 goal of 60 fixtures; either write more or restate the goal.
- Before accounts go live on the hosted site: add `<site>/auth/confirm` and `<site>/auth/callback` to the Auth redirect allow list, paste `supabase/templates/sign-in.html` into the dashboard's templates, and set `SUPABASE_SECRET_KEY` on Vercel for the share-link kill switch.

## Before any launch

- Delete `supabase/seed.sql` and `apps/web/scripts/dev-sign-in.ts`, or prove they still cannot reach the hosted project. They create `anon@test.local` and `admin@test.local`.
- Decide where deck reports go. The report link on a public deck currently opens a prefilled GitHub issue.
- Decide whether public deck pages should be indexed. They are `noindex` today because deck names are user-written and the only moderation is that report link.

## Release process, and a trap to avoid

`develop` is the working branch; `main` is merged from `develop` manually and is what Vercel production and the Supabase integration deploy. **`main` is currently well behind `develop`** — check with `git log --oneline main..develop` before assuming a preview runs on the schema you just wrote.

Merging a migration to `develop` publishes a preview that still runs against **`main`'s** schema. A migration adding a column to a shared read path therefore breaks the develop preview until `main` catches up — this happened with `cards.artist`.

Stacked PRs need the base branch **deleted** on merge, or the child retargeted by hand. A child merged into a base that has already merged elsewhere lands in a dead branch: that happened to #32 and needed #35 to rescue it.
