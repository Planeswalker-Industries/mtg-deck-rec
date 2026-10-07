# Scoring pipeline: sprint checkpoint (2026-10-06)

Where the scoring-pipeline sprint stands, and everything needed to finish it in a fresh session. The design lives in
[`scoring-design.md`](scoring-design.md) (scoring) and [`card-graph-plan.md`](card-graph-plan.md) (data); the tickets
in [`../tasks.md`](../tasks.md); the current state in [`status.md`](status.md); the rules in
[`../../CLAUDE.md`](../../CLAUDE.md). This file points into them rather than repeating them, and can be deleted once the
branch is merged.

## The sprint

- **Goal (owner, 2026-10-06):** finish the whole precompute and scoring pipeline (T057–T065, per `scoring-design.md`
  "Roadmap") on one branch, one task at a time, and merge it into `develop` as one PR.
- **Branch:** `feat/scoring-pipeline`, pushed. Each finished task is its own commit, pushed as a checkpoint (standing
  approval for this branch only).
- **Rules for the remaining work:**
  - **UI is shelved** until the data work is done: build data, scoring, worker, SQL and contract, and list the UI each
    task needs in its ticket instead of building screens.
  - **Every scoring change goes through the evaluation gate** (`../../CLAUDE.md`, "Every scoring change goes through the
    offline evaluation"). A new component ships wired at weight 0 or behind a switch, and gets weight only if the gate
    passes. Report every gate result in the ticket.
  - **Keep the four project docs in step**, as each task so far has (CLAUDE.md, `apps/web/AGENTS.md`, `tasks.md`,
    `status.md`).
  - **Each contract change bumps `CONTRACT_VERSION`** with a changelog entry (`packages/core/src/contract/version.ts`;
    this branch added v20–v25) and updates the mocks.

## Done on the branch

| Commit | Task | What it did | Where it is written up |
|---|---|---|---|
| `3ce7b12` | T055 fix | Substitutes stored per colour identity (shipped first as PR #137, merged to `develop`) | CLAUDE.md "Precompute worker", Substitutes |
| `3a90bae` | T055, T008 | The per-request rec path removed: `rec_add_candidates`, `rec_swap_candidates`, `rec_card_roles`, the timeout retry and `rec_timeouts`, the `servingReads` switch | CLAUDE.md "Recommendations (SQL side)" |
| `b75c775` | T057 | Every weight and threshold in `app_config.scoring`; ranking moved to `@mtg/core/scoring` `rank.ts` | CLAUDE.md "Scoring weights and thresholds"; `tasks.md` T057 |
| `318a5e6` | T058 | `cli eval:holdout` and the gate (`evaluate.ts`) | CLAUDE.md "Every scoring change…"; `tasks.md` T058 |
| `31cf566` | T061 | EDHREC prior by sample size, `edhrecPriorCap` 100; adds recall@20 17.2% → 25.0% on the time split | CLAUDE.md "Scores", The EDHREC prior; `tasks.md` T061 |
| `97f421e` | T059 | Collection mode: availability, built decks, owned twins, buy list (contract v20) | CLAUDE.md "Availability", "Ownership modes"; `tasks.md` T059 |
| `a545362` | T060 | Bracket rules and the "complete a combo" group (contract v21) | CLAUDE.md "Combos", Bracket rules; `tasks.md` T060 |
| `e4957c0` | T062 | Learned curve and land counts, EDHREC role and curve profiles, `curve` component (contract v22); all new switches off, none passed the gate | CLAUDE.md "The learned skeleton"; `tasks.md` T062 |
| `93e43a6` | T064 | Card pairs and deck affinity (contract v23); `deck` weighs 0.1 in adds, recall@20 25.0% → 25.5% | CLAUDE.md "Card pairs and deck affinity"; `tasks.md` T064 |
| `441efb1` | T063 | Build a deck from a commander and a bracket (contract v24, migration `20261006001100`, `POST /api/recs/build`); build overlap 38.6% on the time split | CLAUDE.md "Builds"; `tasks.md` T063 |
| `dc86570` | T065 | Live accept rate: `rec_events`, `record_rec_event`, journey calls, the admin list, `/privacy` (contract v25, migration `20261006001200`) | CLAUDE.md "Live accept rate"; `tasks.md` T065 |

Evaluation results for every task are in its `tasks.md` entry. The latest baseline on the time split (today's local
settings, 2026-10-06): adds recall@20 25.5%, cuts precision@10 25.0%, collection recall 51.3%, builds 38.6% overlap.

## Left to do

### T063: build a deck from a commander and a bracket (done)

Built and committed; see `tasks.md` T063 for the owner's decisions, the evaluation and the shelved UI list.

### T065: live accept rate (done)

Built and committed; see `tasks.md` T065. Build events wait for build mode's screen. Every task in the sprint is done:
what is left is the PR and the release below.

### Then: the PR and the release

PR #139 is open into `develop` and was reviewed on 2026-10-07; the review's fixes are on the branch (migration
`20261007000100` and the commits after the review), and what it left open is T067 and T068 in `../tasks.md`.

**The release order changed with the review: migrations first, then code.** `20261006000200` no longer drops the old
rec functions, so the code on `main` keeps working on the new schema (every serving function keeps its arguments), while
the new code needs the new functions from its first request. The old functions go later (T067).

1. **Merge PR #139 into `develop`.** The `develop` preview then runs new code on hosted's old schema until step 2;
   the daily syncs don't touch the new tables. The VPS worker isn't deployed (heartbeat last 2026-09-16), so nothing
   on the VPS runs this code yet.
2. **Apply the migrations to hosted from `develop`:** `gh workflow run db-push.yml --ref develop`, then confirm hosted
   `supabase_migrations.schema_migrations` reaches `20261007000100`. Production keeps serving on `main`'s code.
3. **Rebuild the data the migrations add** (owner, `cli:hosted`, one at a time, outside 04:00 and 10:00 UTC, checking
   `pg_database_size` after each):
   - `aggregate:corpus --force`: the curve and land counts (T062), then every score with the EDHREC prior's columns
     (T061). Most score rows change once.
   - `precompute --part pairs --full`, then `precompute --part global-pairs --full`: the card pairs (T064).
   - `precompute --part substitutes`: every list is due once (the hash gained the pool weights and reads idf to two
     places). About 90 minutes of database time with almost nothing written; run it off-peak.
   - Combos wait for Spellbook (step 6).
4. **Release `develop` to `main`** (a merge commit, never a squash). Vercel deploys the new code; the Supabase
   integration finds the migrations already applied.
5. **Check production:** p95 add latency against 150/286 ms at p50/p95, one `POST /api/recs/build`, a swap and a cut
   from an account with a collection, and an accept-rate event in the admin Accept rate list.
6. **Spellbook:** set the repository variable `SPELLBOOK_SYNC_ENABLED` to `true` and run "Daily syncs"
   (`gh workflow run sync.yml`), then `cli:hosted collate --only spellbook` and `cli:hosted precompute --part combos`.
7. **Afterwards:** deploy the VPS worker (T066, T068), a first `sync:edhrec` on hosted, and T067 once a rollback to
   the previous build is no longer wanted.

## Working notes for the next session

- **Local database:** the branch's migrations from `20261006000500` on (`20261006001100` and `20261006001200` included) were applied to the running local database by
  hand, with their rows inserted into `supabase_migrations.schema_migrations`; the local data (scores with the prior,
  profiles, combo details, pairs) is built. Don't run `supabase db reset`: it would wipe the local corpus. Apply new
  migrations the same way (`docker exec -i supabase_db_mtg_deck_rec psql … < file`, then insert the version), and
  regenerate `apps/web/src/lib/server/database.types.ts` after schema changes.
- **Evaluation runs:** `MTG_DATA_DIR=X:/mtg_proj yarn workspace @mtg/worker cli eval:holdout --time-split --candidate
  X:/mtg_proj/reports/<file>.json`. A run takes about 9 minutes with pairs and about 3 GB of memory, so run one at a
  time, in the background (`run_in_background`), and expect to be notified. Candidate files and logs are in
  `X:\mtg_proj\reports` (`c-*.json`, `eval-*.log`). Free memory before starting one (only processes the owner allows:
  Discord, Steam, Firefox; never Zed, Docker or other agents).
- **Regression fixtures** (`yarn workspace @mtg/web regress`): one standing miss, Talisman of Hierarchy outside its
  artifact group's top 3, which predates this branch. Everything else passes.
- **Checks before each commit:** `yarn typecheck`, `yarn lint`, `yarn test`, every file in `supabase/tests/` (the list
  is in CLAUDE.md "Commands"), the regression fixtures.
- **Staging:** stage explicit paths only; the untracked `docs/ui_concepts/` images stay out of the repo.
