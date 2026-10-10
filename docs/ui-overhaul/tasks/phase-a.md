# UI overhaul — Phase A — Inventory truth

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

**Order:** A and B can interleave (disjoint files). UI-030 and UI-040 are ready now; the rest of C and D need ARCH-001–003. E needs UI-010. F last, except UI-060–UI-063, which can run any time.

### UI-001: Saving a deck never changes the collection

- **Outcome:** done. Saving a deck never changes the collection.
- **Files:** apps/web/src/components/decks/save-deck-button.tsx, apps/web/e2e/saved-decks.spec.ts, apps/web/AGENTS.md, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done; diff meets criteria after singular/plural dialog selector correction. Four-doc consistency checked; only AGENTS.md carries save-flow detail. Browser verification deferred to gate.

### UI-002: Swap says why there are no replacements

- **Outcome:** done. Swap says why there are no replacements.
- **Files:** apps/web/src/components/deck/use-swipe-rater.ts, apps/web/src/components/deck/swipe-rater.tsx, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done; server-empty versus client-exhausted states distinguished; shared imported Candidates type propagates without journey edits. Rater skip logic unchanged. Targeted lint/typecheck evidence accepted.

### UI-003: Cut and Swap give honest reasons

- **Outcome:** done. Cut and Swap give honest reasons.
- **Files:** apps/web/src/components/deck/journey/cut-phase.tsx, apps/web/src/components/deck/journey/replace-phase.tsx, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done; each file selects reasons once, reserving the last slot for NOT_OWNED. Approved intro copy matches; brief and empty copy unchanged. Targeted lint/typecheck pass.

### ARCH-001: Whole-deck coverage

- **Outcome:** done. Whole-deck coverage.
- **Files:** docs/ui-overhaul/DECISIONS.md, docs/ui-overhaul/TASKS.md
- **Evidence:** 2026-10-09 done; Q-03 closed. Contract changes still need frontend/backend approval before release PR merge.

### UI-010: Coverage function and tests

- **Outcome:** done. Coverage function and tests.
- **Files:** packages/core/src/collection/coverage.ts, packages/core/src/collection/coverage.test.ts, packages/core/src/collection/index.ts, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done; reviewed both new files with no-index diffs and barrel export. Allocation order and capped pools follow ARCH-001, immutable inputs and quantity invariants tested. 45 collection tests and core typecheck pass; no scoring edits.

### UI-013: Coverage contract and server bridge

- **Outcome:** done. Coverage contract and server bridge.
- **Files:** packages/core/src/contract/collection.ts, packages/core/src/contract/transport.ts, packages/core/src/contract/version.ts, packages/core/src/contract/schemas.ts, packages/core/src/contract/schemas.test.ts, packages/core/src/contract/mocks/index.ts, packages/core/src/contract/mocks/mocks.test.ts, apps/web/src/app/deck/actions.ts, apps/web/src/lib/api/real.ts, apps/web/src/lib/server/deck-coverage.ts, apps/web/AGENTS.md, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done. Independent reviewer passed account-inventory isolation (session client, auth.uid-scoped SQL, no private cache). Corrected mock commander double count and removed ignored abort option from the new action; corrected mock tests and both typechecks pass. No hosted operations. Runtime auth isolation remains a local gate check, not proven by static review.

### UI-011: Show coverage in the deck tool

**Status:** done | **Owner:** implementer | **Phase:** A
**Depends on:** UI-010, UI-013 | **Existing tickets:** T069

Show the current Upgrade deck's coverage without adding a third deck-bar line. A compact available count opens a quantity-aware sheet; unavailable data must never masquerade as zero missing cards.

**Read:**
- `docs/ui-overhaul/DECISIONS.md` ARCH-001; `DESIGN-SYSTEM.md` §1, §8
- `web/components/deck/{deck-tool,deck-bar,resolution-issues}.tsx`, `use-deck-tool.ts` (`DeckIssuesChip` is in `resolution-issues.tsx`)
- `web/components/deck/journey/use-deck-journey.ts` (returned working deck)
- `web/components/collection/use-collection-source.ts`, `web/lib/collection-store.ts`, `web/lib/deck-collection.ts`
- `web/components/cards/card-image.tsx`, `web/components/ui/sheet.tsx`, `web/lib/constants.ts`
- `packages/core/src/contract/collection.ts`, `packages/core/src/collection/shortfall.ts`
- `apps/web/e2e/deck-journey.spec.ts`, `collection.spec.ts` (existing setup patterns)

**Write scope:**
- `web/components/deck/{deck-tool,deck-bar}.tsx`, `use-deck-tool.ts`
- `web/components/deck/use-deck-coverage.ts`, `deck-coverage.tsx` (new)
- `web/components/collection/use-collection-source.ts` (add a stable refresh callback and refresh-in-flight indicator; preserve existing source/setSource API and listeners)
- `apps/web/e2e/deck-coverage.spec.ts` (new)
- `apps/web/AGENTS.md` (coverage UI and quantity transport only)
- New files allowed: the three above

**Approved changes:** Upgrade coverage hook/trigger/sheet; aligned browser quantities for coverage and recommendations; no new dependency or styling system.

**Acceptance criteria:**
- [ ] Use the live `journey.deck`, including undo; not initial analysis. Show only in Upgrade with a browser/account collection (even when suggestions ignore it). Hide in Deckbuilder, without a deck/collection, or while raw decklist edits are stale.
- [ ] Browser ownership folds rows with `ownedCounts`, sorts ids and sends aligned quantities; recommendation ownership uses those quantities too. Its change key detects same-length id/quantity edits, not merely id count. Account input includes current open deck id.
- [ ] Request refreshes on deck content, collection source replacement, open deck id, focus and retry; not on bracket/mode alone. Superseded and unmounted responses cannot display; don't render counts for a mismatched key. Catch failures and show `Coverage unavailable` with retry, `Checking collection…` during loading. Never translate failure to empty inventory.
- [ ] Focus/retry first reload the source through `useCollectionSource`, not stale browser quantities held in memory. Expose a stable `refresh` callback and `refreshing` indicator while preserving existing `source`/`setSource` callers. Keep source stable during reload so recommendation settings don't briefly become collection-less; the coverage host invalidates/hides its old counts while refreshing. Source reloads are generation-guarded and unmount-safe; when complete the fresh source object triggers coverage. Register focus in one place only. Test same-tab source-change events and cross-tab browser quantity changes followed by focus (including absent/cleared collection).
- [ ] Replace card-count text with single-line `X/Y available`, where X = exact owned + stand-in + assumed basics. Keep bar to two lines; full accessible name gives owned, stand-in, basics, conflicts and missing counts. Pressable blue/focus treatment and 44px phone hit area follow existing controls.
- [ ] Sheet heading `Your collection and this deck`; explain `Basic lands are assumed available. Cards in another built deck aren't free copies.` Show quantity/image/name rows grouped by all nonzero states with §1 labels, conflict deck names and stand-in source names. Mixed allocations show their quantities, never a single misleading whole-card badge. Zero-size deck says no cards to check. No prices or readiness claims.
- [ ] e2e covers browser quantity changes, no collection, summary/sheet, and a round mutation/undo refreshing coverage using existing mock data. Check the trigger/sheet with keyboard and layout at 390×844 and 1440×900; keep swipe controls visible with Deck stats dock (phase gate).
- [ ] AGENTS.md describes the new UI accurately and no longer says conflicts have no UI. No shared recommendation/ranking algorithm change.

**Non-goals:** builder/saved-page coverage, ownership default, scoring, readiness, changing inventory or marking decks built.

**Validation:**
- `yarn workspace @mtg/web lint src/components/deck/deck-tool.tsx src/components/deck/deck-bar.tsx src/components/deck/use-deck-tool.ts src/components/deck/use-deck-coverage.ts src/components/deck/deck-coverage.tsx e2e/deck-coverage.spec.ts`
- `yarn workspace @mtg/web typecheck`
- Browser/e2e checks run against the fresh build at the Phase A gate.
- `yarn workspace @mtg/web lint src/components/collection/use-collection-source.ts`

**Stop and report if:** working deck is not available from the journey hook, source changes cannot be observed without altering collection state ownership, or the phone layout requires a third line/new global dimensions.

**Gate correction (2026-10-09):** new e2e fails at the ambiguous `^Cut ` locator and at a reload immediately after an optimistic quantity edit. Correct only `apps/web/e2e/deck-coverage.spec.ts`: exact `Cut Lightning Bolt`; confirm IndexedDB quantity persistence before navigation/reload with bounded polling (not sleeps), including both quantity-edit sites. Targeted lint/typecheck, then architect reruns gate e2e. If waiting for persistence exposes an actual collection-editor defect, stop and report separately; do not widen this task. Remaining UI assertions are still unverified.

**Gate retry (2026-10-10):** test corrections accepted and automated/local authenticated checks pass. Visual review found overlapping phone deck-bar colours/coverage text and error/Retry colliding with the collection select. UI-011 is not done; the scoped layout correction followed; evidence is under "Gate evidence" below. The prior persistence concern is resolved, not an app defect.

**Gate accepted (2026-10-10, third attempt):** UI-011 done. Scoped two-row phone layout correction separates error/Retry from collection and edit controls; colour-icon overlap remains owner-accepted. Mock gate, new both-width real-action non-overlap tests, local authenticated suite and supplemental local checks pass. Lead reviewed stable ready/loading/error, sheet and swipe screenshots. Commands, counts and artifact locations are under "Gate evidence" below.

### UI-012: Mark a saved deck as built

- **Outcome:** done. Mark a saved deck as built.
- **Files:** apps/web/src/components/decks/deck-built.tsx, apps/web/src/app/decks/[commander]/[code]/page.tsx, apps/web/src/lib/server/deck-page.ts, apps/web/e2e/saved-decks.spec.ts, apps/web/AGENTS.md, docs/ui-overhaul/PROGRESS.md
- **Evidence:** 2026-10-09 done after correction: rejected transport calls also revert with visible error; owner controls stack on phone and sit beside each other from sm. Existing auth/write action reused, page owner guard intact; lint/typecheck pass. Analogous old visibility-toggle rejection gap recorded as UI-090, not changed here.

## Gate

Once every task in the phase is `done`, run these commands in order, then the manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local data and account prerequisites. Set environment variables in the invoking shell (PowerShell: `$env:NAME='value'`). Mock build/e2e use `NEXT_PUBLIC_USE_MOCKS=1`; real build/e2e use `NEXT_PUBLIC_USE_MOCKS=0`, `E2E_LOCAL_DATA=1`, and `E2E_MAILPIT_URL=http://127.0.0.1:56324` (or the configured local Mailpit URL). Authenticated checks need local Supabase, Mailpit and the real catalog/corpus. Build before each e2e mode so it cannot test a stale bundle.

```sh
yarn workspace @mtg/core vitest run src/collection src/contract/mocks/mocks.test.ts src/contract/schemas.test.ts --reporter=dot
yarn workspace @mtg/web typecheck
yarn workspace @mtg/web lint
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e saved-decks.spec.ts deck-journey.spec.ts deck-coverage.spec.ts --reporter=dot
# Switch to real-data environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e saved-decks.spec.ts account-collection.spec.ts --reporter=dot
yarn workspace @mtg/web e2e deck-coverage.spec.ts --grep "real coverage error" --reporter=dot
```

| Phase | Commands | Manual checks |
|---|---|---|
| A | Mock and real-data commands above | Save with and without a collection; swap with nothing owned; a built deck's cards in another deck's coverage (local authenticated data; no hosted writes). Keyboard and 390×844, 1440×900; swipe controls above dock. If local data/browser access unavailable, record gate blocked, not passed. |

## Gate evidence

Evidence files were moved from a system-temp artifact directory to `$MTG_DATA_DIR/screens/phase-a/` and the check script to `$MTG_DATA_DIR/tools/` on 2026-10-10; the paths below are the new ones.

### 2026-10-09, first attempt

- Pass: `yarn workspace @mtg/core vitest run src/collection src/contract/mocks/mocks.test.ts src/contract/schemas.test.ts` (7 files, 86 tests); `yarn workspace @mtg/web typecheck`; `yarn workspace @mtg/web lint`; mock production build (Next 16.3.5); `git diff --check`.
- **Fail:** mock e2e `saved-decks.spec.ts deck-journey.spec.ts deck-coverage.spec.ts`: 7 passed, 2 failed, 9 skipped (saved decks need Mailpit). The five journey tests and the same-tab coverage notification pass.
  - Coverage viewport/round test: ambiguous locator `^Cut ` matches "Cut Lightning Bolt" and "Cut the rest and move on".
  - Cross-tab test: reloads during the hand editor's debounce; the snapshot after reload shows `2 different cards, 2 copies` (old quantity). Likely a test race, not yet proven an app defect.
  - Traces (local, ignored): `apps/web/test-results/deck-coverage-*/{error-context.md,trace.zip}`.
- Not done: manual keyboard and viewport checks; account scenarios (skipped, not passed).
- Static security and state reviews passed. No commits of app code beyond the checkpoint, no pushes, PRs, migrations or hosted operations.

### 2026-10-10, second attempt

- **Test correction accepted:** only `apps/web/e2e/deck-coverage.spec.ts` changed in application/test code. Exact cut/card locators, readonly IndexedDB polling before both departures, explicit remembered-deck resume, desktop swipe checks before the card leaves the queue, and bounding-box checks for both phone swipe controls above the stats dock. Both real hand edits persist; the earlier failures were test races/flow errors, not a collection-editor defect.
- **Final lead-run automated gate passed:** `yarn workspace @mtg/core vitest run src/collection src/contract/mocks/mocks.test.ts src/contract/schemas.test.ts --reporter=dot` (7 files, 86 tests); `yarn workspace @mtg/web typecheck`; `yarn workspace @mtg/web lint`; `NEXT_PUBLIC_USE_MOCKS=1` production build; `yarn workspace @mtg/web e2e saved-decks.spec.ts deck-journey.spec.ts deck-coverage.spec.ts --reporter=dot` (9 passed, 9 auth-dependent skips); `git diff --check`.
- **Local authenticated suite passed separately:** fresh `NEXT_PUBLIC_USE_MOCKS=0` build, `E2E_MAILPIT_URL=http://127.0.0.1:56324`, `E2E_LOCAL_DATA=1`; `yarn workspace @mtg/web e2e saved-decks.spec.ts account-collection.spec.ts --reporter=dot` (11 passed, no skips). Includes explicit add and owned-only swap with nothing eligible, plus existing saved-deck access checks.
- **Supplemental real-data Chrome/Playwright checks passed:** save without creating a collection; shortfall Save deck leaves the one-copy Sol Ring inventory unchanged; explicit add produces the four expected one-copy entries; built toggle persists across reload; targeted transport rejection rolls it back with a visible error and leaves storage unchanged; another saved deck reports four conflicts naming the built deck. At both widths, Enter/Space open the coverage sheet, Escape returns focus, held coverage reads show loading without stale counts, aborted reads show error without stale counts, and keyboard Retry recovers. Loading/error injection used real server actions (mock APIs are in-memory).
- Supplemental script/evidence live outside the repo: `$MTG_DATA_DIR/tools/phase-a-local-check.mjs`; results in `$MTG_DATA_DIR/screens/phase-a/`: `phase-a-1791637270480-results.json`, and matching `phase-a-1791637270480-*.png`. Run with `node "$env:MTG_DATA_DIR/tools/phase-a-local-check.mjs"` **after a real-data rebuild**; it owns local port 3301 and closes its server/browser. After script review and correction of a request-observation race with polling, the checks ran successfully. Test accounts/decks remain local; none were deleted.
- **Visual gate FAIL despite passing assertions:** lead reviewed stable screenshots (animations disabled, reduced motion). At 390px, the deck bar's colour symbols collide with the ready count and loading/error labels; the error/Retry group runs under the collection select. See `phase-a-1791637270480-390-{success,loading,error}.png`; the corresponding 1440px states are readable. Document-overflow and role/visibility assertions do not catch sibling overlap. Coverage sheets at both widths are readable and show card images/conflict names; earlier translucent sheet captures were mid-animation, not a sheet defect.
- No production edits, contract/schema/scoring changes, commits, pushes, PRs, migrations, hosted operations or account-deletion tests. UI-011 remains in review; Phase B has not started.

### 2026-10-10, third attempt (passed)

- **UI-011 accepted:** implementation reviewed with `git diff --stat` and targeted diffs. Only `deck-bar.tsx`, `deck-coverage.tsx` and `e2e/deck-coverage.spec.ts` changed in application/test code. On phones with coverage, compact commander art stays in the first row and coverage spans the space beneath it; error text does not shrink and Retry reserves its phone target width. Two rows, unchanged ready/error bar height, original copy and existing global dimensions are preserved. No collection-editor change.
- **Mock gate passed in order:** `yarn workspace @mtg/core vitest run src/collection src/contract/mocks/mocks.test.ts src/contract/schemas.test.ts --reporter=dot` (7 files, 86 tests); `yarn workspace @mtg/web typecheck`; `yarn workspace @mtg/web lint`; fresh `NEXT_PUBLIC_USE_MOCKS=1` build; `yarn workspace @mtg/web e2e saved-decks.spec.ts deck-journey.spec.ts deck-coverage.spec.ts --reporter=dot` (9 passed, 11 skips: 9 authenticated and 2 real-action tests, run separately below). Quantity persistence, live round/undo, same-/cross-tab focus refresh and keyboard/swipe checks still pass. `git diff --check` passed.
- **New real-action regressions passed twice:** after a fresh `NEXT_PUBLIC_USE_MOCKS=0` build, `E2E_LOCAL_DATA=1 yarn workspace @mtg/web e2e deck-coverage.spec.ts --grep 'real coverage error' --reporter=dot` (2 passed, no skips). At 390×844 and 1440×900, targeted coverage server actions are held then aborted; loading/error hide stale counts and keyboard Retry recovers. The complete error/Retry group's bounding box must not intersect any other deck-bar button/link (including collection, bracket and edit); colour icons are deliberately excluded. Tests also assert two rows, no clipped error, Retry's 44px phone hit area and both swipe controls above the dock/viewport edge. No production test seam or behavior change.
- **Visual gate passed:** lead inspected stable ready/loading/error, sheet and swipe screenshots at both widths. Error/Retry is clear of interactive neighbors; the remaining phone error/colour-icon overlap is explicitly accepted by the owner. Sheets show readable quantity rows and card images. Final regression screenshots are retained outside the repo under `$MTG_DATA_DIR/screens/phase-a/phase-a-ui011-e2e/deck-coverage-real-coverag-{6c4ca-t-overlap-controls-at-390px,193c0--overlap-controls-at-1440px}/{ready,loading,error,sheet,swipe-controls}.png`.
- **Local authenticated suite rerun passed:** with `E2E_MAILPIT_URL=http://127.0.0.1:56324`, `E2E_LOCAL_DATA=1` and the fresh real build, `yarn workspace @mtg/web e2e saved-decks.spec.ts account-collection.spec.ts --reporter=dot` (11 passed, no skips). Includes explicit add, owned-only swap with nothing eligible and saved-deck access checks.
- **Supplemental local checks rerun passed:** `node $MTG_DATA_DIR/tools/phase-a-local-check.mjs` (12 scenarios): saving without a collection, shortfall save leaves inventory unchanged, explicit add, built persistence and transport-rejection rollback, another saved deck's four named conflicts, both-width sheet keyboard/focus and loading/error/Retry. Lead also inspected the authenticated error/conflict-sheet screenshots. Report: `$MTG_DATA_DIR/screens/phase-a/phase-a-1791639062886-results.json`; matching PNGs share that prefix. Server/browser closed normally; local accounts/decks were not deleted.
- No contract/schema/scoring/security changes, migrations, hosted operations, commits, pushes or PRs. Phase B has not started. Existing contract v27 release approvals remain outstanding, separate from this local phase gate.
