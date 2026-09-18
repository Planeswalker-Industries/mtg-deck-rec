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
- **Released to `main` 2026-09-17 20:48 UTC** (PR #41, 21 commits, contract v5 → v9): saved decks and their pages, the timeout retry and `rec_timeouts`, `cards.keywords`, deck grouping, and the deck workspace with reopening and auto-save.
- **Database:** Supabase Free, `us-east-2`, **381 MB of 500 MB** (375 MB before that release; `cards.keywords` cost the +6 MB the local measurement predicted). Migrations in `supabase/migrations` are applied by Supabase's GitHub integration when **`main`** changes; `.github/workflows/db-push.yml` is the manual fallback.
- **Scryfall data:** `.github/workflows/sync.yml` runs daily (repo variable `SYNC_ENABLED`, currently `true`). Catalog 34,829 cards, 525,299 printings. `artist` and `keywords` are both fully populated on hosted; art backdrops render live.
- **Corpus on hosted:** 129 commanders have stats. Aggregates are rebuilt from this PC with `cli:hosted aggregate:corpus`.

## Open work

### 1. Accounts are reachable on the live site and sign-in there is not set up

The release put `/sign-in`, `/account`, `/decks` and account collections on the hosted site for the first time. Three pieces of dashboard work are still missing, none of them code:

- Add `https://mtg-app-psi.vercel.app/auth/confirm` and `/auth/callback` to the Supabase Auth redirect allow list. Without them Supabase falls back to the site URL and the emailed link breaks.
- Paste `supabase/templates/sign-in.html` into the dashboard's email templates.
- Set `SUPABASE_SECRET_KEY` on Vercel, which the share-link kill switch needs.

Until then the hosted site shows the sign-in form and the email does not work.

### 2. The deck lookup collector isn't running anywhere

The deck tool offers "Pull decks" for commanders without data, but no `serve:commander-requests` worker is running, so requests wait in `commander_requests` and the UI reports the collector offline. It needs the corpus files, so it runs from this PC (`cli:hosted serve:commander-requests`) until there is another plan.

### 3. Swap timeouts on the hosted database — mitigated, watch it

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

### 4. Recommendation direction: Collection Fit (decided 2026-09-18)

A recommendation should answer *"given the deck I want and the cards I actually own, what should my version look like?"* — not *"what do Commander players generally play?"*. That means a weighted blend of several signals rather than one play-rate ranking, which is already the shape of `blendScore`: a weighted sum over named components that renormalizes when data is missing. `ScoreBreakdown` already returns per-component values **and** effective weights, so the "why this card" panel needs no new plumbing, only a renderer.

Where the signals stand:

| Signal | State |
|---|---|
| Commander synergy | Built. `commander_card_stats.synergy` is shrunk inclusion − baseline p0 — the same formula EDHREC documents, from our own corpus, with shrinkage they don't appear to apply. |
| Deck role fit | Built (`role`). |
| Collection | **Stays a hard filter, not a weighted term** (owner decision 2026-09-18). An owned card cannot outrank a better unowned one; owned-only removes everything else from the pool instead. Revisit if people ask why a cheap card they own never shows up beside an expensive one they don't. |
| Price | To build: a weighted component, with a toggle to turn cost weighting off. Suppressed while owned-only is on, where everything already costs nothing. |
| Deck-internal synergy | To build, approximated from functional tag overlap with the rest of the deck — "fits the sacrifice theme you're already on". Real card-pair co-occurrence is an N² aggregate over ~15k decks and the hosted database is at 381 MB of 500 MB, so measure whether tags are enough before paying for it. |
| User preference | Wired (`votes`, 0.1 swap / 0 add) with no data. Waits on the swap-quality eval. |

**EDHREC, pinned.** The intent is to compare our synergy against theirs as a check on our own corpus, and only then consider ingesting it as one more signal — a comparison, never a source of truth. They aggregate from the same public deck sites we do.

**Before any ingestion happens, the terms question has to be settled and written down here with the permitting language.** The hard constraints in `CLAUDE.md` currently forbid `json.edhrec.com`, and a note from 2026-09-15 records that their terms forbid automated queries. A one-off manual comparison needs none of that; a live dependency does.

### 5. Smaller items

- **`collections.maxEntries` is 100,000**, about 23 MB per account. Six maxed accounts would exhaust the free tier's headroom. It lives in `app_config.collections`, so lowering it is a SQL update with no deploy.
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

`develop` is the working branch; `main` is merged from `develop` manually and is what Vercel production and the Supabase integration deploy. Check with `git log --oneline origin/main..origin/develop` before assuming a preview runs on the schema you just wrote — and use the `origin/` refs, because a stale local `main` reported a 104-commit gap where the real one was 21.

Merging a migration to `develop` publishes a preview that still runs against **`main`'s** schema. A migration adding a column to a shared read path therefore breaks the develop preview until `main` catches up — this happened with `cards.artist`, and `cards.keywords` was the same shape (it is in `CARD_COLUMNS`).

**A column added to `content_hash` is empty on hosted until a sync rewrites the rows.** Applying the migration is not the end of the release: the daily run fills it, or `yarn workspace @mtg/worker cli:hosted sync:catalog --force` does it at once. That is a hosted write, so it needs a human to ask for it.

Stacked PRs need the base branch **deleted** on merge, or the child retargeted by hand. A child merged into a base that has already merged elsewhere lands in a dead branch: that happened to #32 and needed #35 to rescue it.
