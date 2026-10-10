# UI overhaul — Phase B — Collection setup

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

### UI-020: Start a collection by hand

**Status:** done | **Owner:** implementer | **Phase:** B
**Depends on:** none | **Existing tickets:** T038

A player with a handful of cards can't start a collection without making a file. The empty state offers adding cards by name.

**Read:**
- `web/components/collection/collection-view.tsx` (the `none` state near line 76, `ReadyView`)
- `web/components/collection/collection-edit.tsx` (`AddToCollection`)
- `web/components/collection/use-collection-editor.ts` (how writes go to browser and account)
- `web/components/collection/use-collection-view.ts`, `use-collection-source.ts` (how the view learns a collection now exists)
- `web/lib/collection-store.ts` (`saveCollection`, `updateCollectionRows`)
- `packages/core/src/collection/edit.ts` (`setCardQuantity`)
- `docs/tasks.md` T038

**Write scope:**
- `web/components/collection/collection-view.tsx`
- `web/components/collection/use-collection-editor.ts`
- `web/components/collection/collection-edit.tsx` (only if `AddToCollection` needs a prop for the empty case)
- `web/lib/collection-store.ts` (only to create an empty browser collection)
- `apps/web/e2e/collection.spec.ts` (one new test)
- New files allowed: none

**Approved changes:** creating a collection from the first hand-added card.

**Acceptance criteria:**
- [x] The empty state offers **Add cards by name** beside **Import your collection**; choosing it shows the add-by-name search.
- [x] Signed out: the first card added creates a browser collection with the usual 7-day expiry; the page switches to the normal collection view.
- [x] Signed in: the first card goes through `set_collection_card_quantity` and creates the account collection.
- [x] `notifyCollectionChanged()` fires so the deck tool sees the new collection.
- [x] e2e (mocks): from empty, add one card by name, see it in the collection.

**Non-goals:** import, bulk entry.

**Validation:**
- `yarn workspace @mtg/web lint src/components/collection/collection-view.tsx src/components/collection/use-collection-editor.ts src/lib/collection-store.ts`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** `set_collection_card_quantity` refuses an account with no collection rows (that needs a migration and the architect).

### UI-021: Import adds to the collection or replaces it

**Status:** blocked | **Owner:** implementer | **Phase:** B
**Depends on:** none | **Existing tickets:** none

Every import replaces the collection today. A player importing a new binder or a recent haul should be able to add it.

**Read:**
- `web/components/collection/collection-tool.tsx` (`importText`, `saveToAccount` with `mode: "replace"`, `saveToBrowser`)
- `web/lib/collection-store.ts` (`saveCollection`, `loadCollection`)
- `web/app/collection/actions.ts` (`saveCollectionBatchAction`, which `mode` values it accepts)
- `docs/ui-overhaul/DESIGN-SYSTEM.md` §3

**Write scope:**
- `web/components/collection/collection-tool.tsx`
- `web/lib/collection-store.ts`
- New files allowed: none

**Approved changes:** an add/replace choice; merging a browser collection.

**Acceptance criteria:**
- [ ] With no collection, the form is as today.
- [ ] With a collection, two radio options above the submit button: **Add to my collection** (default) and **Replace my collection**. The button reads "Add to collection" or "Replace collection" accordingly.
- [ ] Account: add uses `mode: "merge"`; replace keeps `mode: "replace"`.
- [ ] Browser: add appends the new resolved rows to the stored rows (quantities of the same card add up through the existing per-card fold), keeps the existing unmatched lines plus the new ones up to `MAX_UNMATCHED_KEPT`, and renews the expiry.
- [ ] The summary after import says which happened ("Added 240 cards" / "Replaced your collection").

**Non-goals:** a preview step (UI-024), the link import's paging.

**Validation:**
- `yarn workspace @mtg/web lint src/components/collection/collection-tool.tsx src/lib/collection-store.ts`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** `saveCollectionBatchAction` or `start_collection_import` doesn't accept `merge`.

**SQL prerequisite resolved locally (2026-10-10):** owner-approved migration `20261010000100_collection_import_diff.sql` replaces the delete-and-reinsert branch with diff-only writes; local assertions and independent SQL/security review passed (see Gate evidence). Subsequent browser verification reproduced stale-sync replacement corruption and hidden account inventory during pending/failed sync; these block completion. Hosted deployment was not requested or performed.

### UI-022: After importing, go back to what you were doing

**Status:** review | **Owner:** implementer | **Phase:** B
**Depends on:** none | **Existing tickets:** none

Links to the import from the deck tool lose the player's place: after importing, the main button is "Browse your collection".

**Read:**
- `web/app/collection/import/page.tsx`
- `web/components/collection/collection-tool.tsx` (`CollectionSummary`'s buttons)
- `web/components/deck/deck-tool.tsx` (the "Import your collection first" link near line 467)
- `web/components/deck/deck-bar.tsx` (the "Add collection" link near line 221)
- `web/lib/safe-path.ts`
- `apps/web/AGENTS.md` "Next.js 16.3" (search params must sit inside `<Suspense>`)

**Write scope:**
- `web/app/collection/import/page.tsx`
- `web/components/collection/collection-tool.tsx`
- `web/components/deck/deck-tool.tsx` (the one link)
- `web/components/deck/deck-bar.tsx` (the one link)
- New files allowed: none

**Approved changes:** a `next` search parameter on `/collection/import`.

**Acceptance criteria:**
- [ ] Both deck-tool links go to `/collection/import?next=/deck` (keeping `?deck=<code>` when a saved deck is open, if the link site knows it).
- [ ] After a successful import with a `next`, the summary's primary button is **Back to your deck** (to `safeNextPath(next, "/deck")`); "Browse your collection" becomes secondary.
- [ ] Without `next`, unchanged.
- [ ] `useSearchParams` is read inside `<Suspense>` per AGENTS.md.

**Non-goals:** auto-redirecting.

**Validation:**
- `yarn workspace @mtg/web lint src/app/collection/import/page.tsx src/components/collection/collection-tool.tsx src/components/deck/deck-tool.tsx src/components/deck/deck-bar.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** UI-021 is in progress on `collection-tool.tsx` (run one after the other, not in parallel).

### UI-023: How to export from each app

**Status:** draft | **Owner:** implementer | **Phase:** B | **Depends on:** Q-05

A collapsed "How do I export my collection?" block on the import page with steps for ManaBox, Moxfield, Archidekt and TCGplayer. Blocked on verified steps (Q-05); never ship guessed instructions.

### UI-024: Fix unmatched lines before saving

**Status:** draft | **Owner:** architect to spec | **Phase:** B | **Depends on:** UI-021

A preview after matching: N matched, M unmatched with a name search per unmatched line to pick the card, then save. Needs a spec for where corrected rows go (resolved rows, so the import functions are unchanged).

## Gate

Once every task in the phase is `done`, run these commands in order, then the manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local data and account prerequisites. Set environment variables in the invoking shell (PowerShell: `$env:NAME='value'`). Mock build/e2e use `NEXT_PUBLIC_USE_MOCKS=1`; real build/e2e use `NEXT_PUBLIC_USE_MOCKS=0`, `E2E_LOCAL_DATA=1`, and `E2E_MAILPIT_URL=http://127.0.0.1:56324` (or the configured local Mailpit URL). Authenticated checks need local Supabase, Mailpit and the real catalog/corpus. Build before each e2e mode so it cannot test a stale bundle.

```sh
yarn workspace @mtg/web typecheck
yarn workspace @mtg/web lint
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e e2e/collection.spec.ts --reporter=dot
# Switch to real-data environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e account-collection.spec.ts --reporter=dot
```

The `e2e/collection.spec.ts` filter deliberately excludes `account-collection.spec.ts`; authenticated coverage is the separate real-data run, not mock skips.

| Phase | Commands | Manual checks |
|---|---|---|
| B | Mock and real-data commands above (Mailpit) | Start by hand signed out and signed in; add vs replace; return to the deck |

## Gate evidence

### 2026-10-10 — UI-020–022 implementation/review pass (not a phase gate)

- UI-020–022 were implemented in one sequential batch. No commits, hosted operations, SQL execution or account-deletion tests. The implementation pass supplied no final verification report or screenshots; independent review and checks follow below.
- Lead reviewed `git diff --stat`, then targeted diffs: eight code/test files, 224 insertions / 36 deletions. UI-020 reuses the search/editor, creates browser storage only on the first successful hand add, serializes writes, waits for pending writes before notifying, and keeps failed-write rollback. IndexedDB completion now waits for transaction commit.
- UI-021 adds default-merge/explicit-replace controls and operation summaries; browser merge preserves printing rows, folds quantities through existing consumers, retains capped old/new unmatched lines and renews expiry. Account requests pass the selected mode; browser data is no longer cleared before an account import succeeds.
- UI-022 wraps import search params in Suspense, validates the return path through `safeNextPath`, preserves known saved-deck codes in both import links, and only offers the primary return action after a successful import.
- Implementation checks: scoped ESLint passed; `yarn workspace @mtg/web typecheck` passed. The editor's final notification adjustment followed those checks; the subsequent fresh mock production build (including TypeScript) passed. Build log: `$MTG_DATA_DIR/tools/phase-b-build.log`.
- Lead `git diff --check` passed after the state/evidence/reference-doc updates.
- `NEXT_PUBLIC_USE_MOCKS=1` fresh build followed by `yarn workspace @mtg/web e2e collection.spec.ts --reporter=line`: **8 passed, 2 skipped** (20.8 s). The filename filter also selects `account-collection.spec.ts`; those two account tests skipped, so this is not signed-in verification. Log: `$MTG_DATA_DIR/tools/phase-b-e2e.log` (UTF-16).
- New passing regressions cover empty hand-add/no storage merely opening search, reload persistence/seven-day expiry/deck availability; add quantities and unmatched-line retention versus explicit replace; both deck links, successful return with saved-deck query, unsafe-next fallback, and failed import preserving the collection/no return CTA.
- **Blocking review finding:** the only definition of `commit_collection_import` is `supabase/migrations/20260914002400_account_collections.sql:187–231`; lines 210–222 delete all the user's collection rows on replace and then insert/upsert. This is pre-existing but violates the binding diff-only write rule. Neither this batch nor a passing mock build fixes it. UI-021 is blocked pending a separately scoped new migration, explicit API grants, local SQL assertions and independent SQL review.
- **Unverified interaction:** a signed-in browser collection still waiting for `AccountCollectionSync` is deliberately retained on merge. `useCollectionSource` prefers that browser copy on refresh; verify combined quantities and summary/return correctness through sync success/failure, and ensure replacement cannot race the old browser sync. No failing reproduction was established in this pass.
- **Remaining:** screenshots were not captured in this pass. Lead visual review at 390×844 and 1440×900, signed-in first-card/add/replace behavior, saved-deck-link context at the originating UI, and the full Phase B gate are pending. UI-020/022 stay review, UI-021 blocked; UI-023/024 remain draft. No acceptance checkboxes imply unperformed manual verification.

### 2026-10-10 — SQL correction approval checkpoint (not a phase gate)

- **Action:** followed the approval-first next action; no implementation, migration or SQL execution before owner consent. UI-021 remains blocked awaiting approval; UI-020/022 remain review. Existing implementation/tooling changes were left untouched.
- **Verified from source:** migration search still finds only `supabase/migrations/20260914002400_account_collections.sql:187–231` defining `commit_collection_import`. Its replacement branch deletes all caller-owned items (210–212); its upsert rewrites conflicts (214–222). The identity index (57–59) includes card, nullable printing, finish, condition and language. Existing execute revokes/grants are at 246/251. `20260922000400_collection_card_quantity.sql:33` uses a per-user advisory transaction lock.
- **Proposed change / reason:** a new migration replaces only the import RPC implementation, not the historical migration or contract. Normalize and aggregate staged rows using the current card/printing rules, then diff against the caller's items: delete only identities absent from a replacement, update only changed quantities, insert only missing identities. Merge continues adding quantities with the existing cap, without rewriting entries already at that cap. Preserve unchanged item IDs, `updated_at` and `import_id`; changed/new entries receive the current import metadata. Import status still records successful commits even when no item changes.
- **Migration and permissions:** retain the signature/result, `security definer`, empty `search_path`, `auth.uid()` ownership, staging atomicity and config-driven limits. Serialize commits using the same per-user advisory lock as hand edits and retain import-row locking. Explicitly revoke execute from `PUBLIC`/`anon` and grant it to `authenticated`/`service_role`; no new tables, API exposure, RLS changes or contract version change are proposed.
- **Data risk:** applying the function migration does not rewrite inventory. Later explicit replacements intentionally remove entries absent from the normalized import, including all entries for an empty replacement; incorrect identity comparison could delete or conflate printings. Local assertions must cover nullable printing identity, duplicate/invalid rows, changed/new/removed/unchanged entries (including unchanged row-version/metadata), capped merge, empty replace, unauthorized access, repeated commit, config-limit rollback and import/hand-edit serialization. No account-deletion tests.
- **Rollback:** a failed migration rolls back transactionally. If verification fails after local application, stop account imports and use a corrective migration; restoring the prior function alone would reintroduce the forbidden full rewrite and is not an acceptable enabled fallback. No table/data backfill is involved, and reverting a function cannot restore collection changes already committed. Hosted rollout or any hosted recovery requires a separate owner request.
- **Required after approval:** implementation and local SQL checks, independent SQL/security review, then the outstanding browser/account and visual verification before any Phase B gate. Browser-to-account sync races remain a separate unverified interaction; database locking alone does not prove that flow safe.
- **This pass's checks:** read-only source inspection and documentation diff review; no runtime tests, screenshots, gate, hosted operations or commits. Approval has been requested, not granted.

### 2026-10-10 — Approved diff-only import migration and SQL review (not a phase gate)

- **Owner approval:** "yes and commit" approved the preceding migration proposal, implementation, local verification and commit. This pass is one SQL implementation batch plus its required review; it does not authorize a hosted deployment. Only migration/tests/reference documentation and state/evidence are included in the commit; existing UI and local-tooling changes stay uncommitted.
- **Implementation:** `supabase/migrations/20261010000100_collection_import_diff.sql` replaces only `commit_collection_import(bigint)` and its explicit execute permissions. Replacement deletes missing normalized identities, updates changed quantities and inserts missing entries; merge remains additive/capped. Unchanged items retain IDs, physical row versions, timestamps and import provenance. Successful no-op imports still complete/clear staging. Shared per-user advisory locking serializes imports with hand edits, alongside the existing per-import lock. Contract, tables, RLS and config limits are unchanged.
- **Local application:** confirmed no unrelated pending local migrations, then `supabase migration up --local` applied only `20261010000100`. Lead independently confirmed that version in local migration history and the installed function's `security definer`, empty `search_path` and execute ACL (`postgres`, `authenticated`, `service_role` only).
- **Durable regression:** new `supabase/tests/collection-import.sql` passed **34 assertions**, with `ON_ERROR_STOP` and assertion exceptions ensuring nonzero failure. Covers identity dimensions, normalization/duplicates/invalid printings/unknown cards, changed/new/removed/unchanged rows and provenance, repeat/no-op imports, capped merge, empty replacement, totals/staging/status, ownership/auth/permissions and rollback on entry-limit failure. Existing `collection-editing.sql` passed **16 assertions, 0 failures**. Both suites roll back their fixtures; no account-deletion tests.
- **Exact SQL commands:** `cmd /c "docker exec -i supabase_db_mtg_deck_rec psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/tests/collection-import.sql"` and the same command with `supabase/tests/collection-editing.sql`.
- **Concurrency:** the local system-temp artifact `collection-import-locks.py`, run with Python, passed hand-edit/import, import/hand-edit and import/import directions. Two authenticated local sessions exercised the RPCs; a third observed `pg_blocking_pids` and an advisory wait, then the waiting call completed after release. All transactions rolled back. The hand edit and import were no-ops; this proves lock contention/release, not all concurrent data outcomes. Large-import performance and staging/commit contention were not empirically tested.
- **Review:** lead read stat first, targeted docs/new-file diffs and concurrency runner. Independent SQL/security review returned **PASS, no actionable SQL/security findings**, and independently reran both SQL suites and all three concurrency cases. `git diff --check` passed; no schema/contract expansion or unrelated code changes.
- **Remaining:** UI-021 moves from blocked to review, not done; UI-020/022 stay review. Browser-sync success/failure/races, signed-in UI behavior, screenshots at both required sizes, UI-023/024 and the Phase B gate remain outstanding. No build, screenshot, phase gate, hosted operation or push in this SQL-only pass.

### 2026-10-10 — Browser/account verification and visual review (not a phase gate)

- **Batch:** browser and account verification completed with a verification report. Verification-only scope: no production fixes. Changed only `apps/web/e2e/account-collection.spec.ts` (explicitly select replacement in the old test; retain a new failing race regression). Lead reviewed stat first, the targeted test diff, and the relevant existing hand-add/store/deck-link diffs. Existing UI/tooling changes were preserved.
- **Environment/build:** verified loopback Supabase and local Mailpit (`http://127.0.0.1:56324`) without printing secrets. Fresh `yarn workspace @mtg/web build` passed with `NEXT_PUBLIC_USE_MOCKS` explicitly empty so dotenv could not reenable it. Tests used fresh local production servers, `E2E_LOCAL_DATA=1`, `E2E_MAILPIT_URL`, and isolated local test accounts; runner stopped only its own server processes. Current `.next` is real-data, not mocks.
- **Checks:** `yarn workspace @mtg/web e2e account-collection.spec.ts --reporter=line` initially **2 passed, 0 skipped** after correcting the stale replacement expectation; with the reproduced regression, **2 passed, 1 failed, 0 skipped**. `yarn workspace @mtg/web lint e2e/account-collection.spec.ts`, `yarn workspace @mtg/web typecheck`, and `git diff --check` passed. This is deliberately not a passing suite or phase gate. The temporary runner exits zero while recording the expected failing suite; the suite result above, not its wrapper exit, is authoritative.
- **UI-020 complete:** signed-out and real signed-in empty search → first Sol Ring → normal collection → reload persistence passed; the deck starter recognized inventory. Source review confirms the account RPC path and post-write notification. Together with the earlier passing mock regression (no storage merely opening search, seven-day expiry, reload and deck availability), all UI-020 criteria are met. Lead marks UI-020 done; this does not establish deck quantities under sync races.
- **Normal account flows:** Sol Ring 3 plus default add 2 gives 5 in browse; explicit replacement with Arcane Signet 2 removes Sol Ring and survives reload. Invalid replacement preserves the old inventory and does not offer a successful-return CTA. Successful `/deck` return navigation and Owned first control passed. Both unsaved-deck originating links preserve `next=/deck`; `/deck?deck=phase-b-code` was checked as a return href only, not as an actual saved deck.
- **Blocker — replacement race:** import browser Sol Ring 3, sign in, intercept its real merge action before it reaches the server, and keep that request pending. In a second tab, explicitly replace with Arcane Signet 2; verify successful replacement and browser-copy clearance. Release the old merge, then reload: expected Arcane 2 / Sol Ring 0 / total 2; actual Arcane 2 / Sol Ring 3 / total **5**, persisting after reload. Durable regression: `an old browser sync cannot restore rows after an explicit account replacement`. Its total assertion fails expected `2`, received `5`. Actual local writes are used, not mocked successful commits. Clearing IndexedDB cannot invalidate already-snapshotted sync rows; SQL transaction locking does not prevent the later stale merge.
- **Blocker — hidden account inventory:** hold browser sync with Sol Ring 3 while a separate real account add commits 2. Summary shows only browser 3 instead of combined 5 (or an explicit account/browser breakdown), even after import success. Abort sync and keep retries failing: browser data survives, but summary and browse still show only 3 and claim “Moving it to your account…”. Allow retries and reload: 5 is recovered without double-counting. Delayed successful sync likewise reaches 5 and persists after reload. `useCollectionSource`'s browser-first result hides the newly committed account inventory; success/return must not imply that partial view is complete.
- **Lead visual review:** verification captured 34 exact-size viewport PNGs in a local system-temp artifact directory (`screens/B`). Lead opened browser/account empty-search and populated-hand views, account add/replace control views, and successful-return summaries at **390×844 and 1440×900**, plus failed-sync and post-race phone summaries. Card art loaded with copyright areas unobscured; reviewed controls/text fit without collisions. Phone mode controls require ordinary vertical scrolling and were reviewed in scrolled captures. Verification measured no horizontal overflow. The misleading sync totals are behavior blockers, not a layout pass. Existing singular-count grammar (“1 different cards, 1 copies”) is a minor copy follow-up, not introduced by this batch.
- **Artifacts:** local system-temp artifact `phase-b-summary.md` holds the compact verification report; `phase-b-setup.cjs`, `phase-b-run.cjs` (`--suite-only`, `--probes-only`, `--followups-only`, `--normal-only`, `--hand-only`) and `phase-b-checks.cjs` reproduce local checks. Trace/error context are in the local `phase-b-test-results` artifact directory; screenshot examples: `screens/B/failed-after-release-390x844.png` and `replacement-after-release-390x844.png`.
- **Next / limits:** UI-021 is blocked on a coordinated sync/import correction; UI-022 stays review. Retain inventory assertions when adapting the race harness to a fix that serializes operations. Add durable pending/failure coverage, verify deck per-card quantities through return/reload, and verify actual saved-deck originating links; neither a loaded-collection indicator nor an Owned first control proves those quantities. Any newly required schema/contract change needs owner approval first. UI-023/024 stay draft. No gate, schema change, hosted operation, account-deletion test, commit or push this pass.
- **Subsequent owner request:** “commit then remind me of the phases” authorizes a Phase B UI/test/evidence checkpoint commit, including the known failing regression; unrelated local tooling is excluded. This is not phase completion or permission to push/deploy.
