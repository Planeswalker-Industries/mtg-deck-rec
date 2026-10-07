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
    this branch added v20–v23) and updates the mocks.

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
| T063 commit | T063 | Build a deck from a commander and a bracket (contract v24, migration `20261006001100`, `POST /api/recs/build`); build overlap 38.6% on the time split | CLAUDE.md "Builds"; `tasks.md` T063 |

Evaluation results for every task are in its `tasks.md` entry. The latest baseline on the time split (today's local
settings, 2026-10-06): adds recall@20 25.5%, cuts precision@10 25.0%, collection recall 51.3%, builds 38.6% overlap.

## Left to do

### T063: build a deck from a commander and a bracket (done)

Built and committed; see `tasks.md` T063 for the owner's decisions, the evaluation and the shelved UI list.

### T065: live accept rate

Ticket: `tasks.md` T065. Design: `scoring-design.md` "Evaluation" (the `rec_events` bullets: one row per shown batch and
per accept or decline, keyed like `swap_votes`, written through a rate-limited security-definer function, RLS on, no
API reads, `/privacy` line with no opt-out).

What to reuse: `cast_swap_vote` and `swap_votes` (the keying by `auth.uid()` or the salted visitor hash), the `vote`
rate-limit bucket pattern (`app_config.rate_limits`), the admin read pattern (`require_platform_admin()`, `/api/admin/*`,
`components/admin/`).

Open decisions: recording needs calls from the deck tool's journey (`use-deck-journey.ts`), which is plumbing rather
than screens; the admin view and the `/privacy` line are UI and copy. Confirm with the owner how much of that counts as
shelved UI.

### Then: the PR and the release

1. **One PR into `develop`** (`gh pr create --base develop`, a short title of about 50 characters). CI applies every
   migration from scratch, builds with mocks and runs e2e.
2. **Not before production serves from the precompute tables.** Hosted still has `app_config.recs.servingReads` off and
   its migrations stop at `20261005001000` (checked 2026-10-06), so PR #137's migration (`20261006000100`) hasn't
   reached hosted. The branch deletes the old request path (`20261006000200`), so the order is:
   1. Release `develop` (with #137) to `main`; confirm hosted applied `20261006000100` (the Supabase integration can
      come unlinked: `db-push.yml` is the fallback).
   2. Rebuild hosted substitutes: `yarn workspace @mtg/worker cli:hosted precompute --part substitutes` (about 90
      minutes; the new function's hash makes every list due).
   3. Hosted parity (`apps/web/scripts/serving-parity.ts` on `develop`'s code, before this branch removes it), then
      switch `servingReads` on in production. Hosted writes are the owner's (`CLAUDE.local.md`).
   4. Only then merge this branch, and release it to `main`.
3. **After this branch's migrations reach hosted** (`20261006000200` to `20261006001100`, in order), rebuild the data
   they add:
   - `cli:hosted aggregate:corpus --force`: the curve and land counts (T062).
   - `cli:hosted precompute --part scores --force`: the EDHREC prior's columns and profiles (T061, T062). It rewrites
     most score rows once; check disk afterwards.
   - `cli:hosted precompute --part combos --force`: `spellbook_combo_details` (T060).
   - `cli:hosted precompute --part pairs --full` and `--part global-pairs`: the card pairs (T064).
   - Then the open check from T064: p95 add latency on hosted not worse than before.
   - `20261006001100` (T063) only adds `app_config.scoring.build` and `serving_build_pool`; nothing to rebuild.

## Working notes for the next session

- **Local database:** the branch's migrations from `20261006000500` on (`20261006001100` included) were applied to the running local database by
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
