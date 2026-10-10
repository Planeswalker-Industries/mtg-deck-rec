# UI overhaul — Phase D — Generate and adapt

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

### UI-040: Pick a commander you own

**Status:** ready | **Owner:** implementer | **Phase:** D
**Depends on:** none | **Existing tickets:** T050

`/deck?start=build` searches every commander. With a collection, it should start from the ones the player owns.

**Read:**
- `web/components/rater/commander-picker.tsx`
- `web/components/deck/deck-tool.tsx` (the `showPicker` section near line 425, `buildFrom`, `context.ownership` / `useCollectionSource`)
- `packages/core/src/contract/cards.ts` (`CardSearchInput.ownedOnly`)
- `web/lib/api/real.ts` (how `searchCards` sends `ownedOnly`)

**Write scope:**
- `web/components/rater/commander-picker.tsx`
- `web/components/deck/deck-tool.tsx` (the picker section only)
- New files allowed: none

**Approved changes:** an optional `ownedOnly` prop on `CommanderPicker`; a two-option toggle on the build start.

**Acceptance criteria:**
- [ ] `CommanderPicker` accepts `ownedOnly?: OwnershipInput` and passes it to `searchCards`.
- [ ] On the build start with a collection, a segmented control (the existing `Segmented` in `deck-tool.tsx`) offers **From my collection** (default) and **Any commander**.
- [ ] Without a collection, the picker is as today, with the line "Import your collection to pick from commanders you own." linking to `/collection/import?next=/deck?start=build` (URL-encoded).
- [ ] The "Searching…" hint renders an ellipsis character, not `â€¦` (fix the mis-encoded literal in `commander-picker.tsx`).

**Non-goals:** what happens after picking (UI-041), the rater page's use of the picker.

**Validation:**
- `yarn workspace @mtg/web lint src/components/rater/commander-picker.tsx src/components/deck/deck-tool.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** an account collection can't be sent as `ownedOnly` from the client (the deck tool's `context.ownership` shape is not `OwnershipInput`).

### ARCH-003: Build screen and the three choices

**Status:** draft | **Owner:** architect | **Phase:** D | **Resolves:** Q-01, Q-02

Specify: the build screen for `recs.build` (`BuildResult`: groups with origin and score, basics, land target, feasibility, combos, bracket estimate); the "can't reasonably make" rule (Q-01, settings in `app_config.scoring.build`); Continue anyway (a new fill mode that ignores `build.qualityFloor`: core `build.ts` with tests, contract bump, and whether `eval:holdout`'s build overlap must not fall); Swap commander (Q-02: ranking method, its cost, where it runs); Add singles (`fill: 'value'`, unknown prices per D-05); saving a build; accept-rate events for mode `build` (T065). Split into ready tasks UI-041–UI-044.

### UI-041: Build screen

**Status:** draft | **Phase:** D | **Depends on:** ARCH-003, UI-040

### UI-042: Continue anyway

**Status:** draft | **Phase:** D | **Depends on:** ARCH-003, UI-041

### UI-043: Add singles

**Status:** draft | **Phase:** D | **Depends on:** ARCH-003, UI-041, UI-030 (reuses `BuyList`)

### UI-044: Swap commander

**Status:** draft | **Phase:** D | **Depends on:** ARCH-003, UI-041

### UI-045: Adapt an online list

**Status:** draft | **Phase:** D | **Depends on:** ARCH-002, UI-041

## Gate

Once every task in the phase is `done`, run these commands in order, then the conditional and manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local data, accounts and SQL prerequisites. Set `NEXT_PUBLIC_USE_MOCKS=1` in the invoking shell for build/e2e (PowerShell: `$env:NEXT_PUBLIC_USE_MOCKS='1'`). Build first so e2e cannot test a stale bundle. Mock auth/local-data skips do not establish authenticated or real-data coverage; retain the conditional SQL/holdout and manual checks.

```sh
yarn test
yarn typecheck
yarn lint
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e --reporter=dot
```

| Phase | Commands | Manual checks |
|---|---|---|
| D | Commands above; `yarn workspace @mtg/worker cli eval:holdout` if ARCH-003 changed scoring; SQL tests touched by any migration (local prerequisites and commands in [testing](../../reference/testing.md)) | All three journeys at 390×844 and 1440×900; each shortfall choice |
