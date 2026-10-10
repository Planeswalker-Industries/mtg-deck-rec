# UI overhaul — Phase E — Finish

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

### UI-050: Copy or download the deck from Done

**Status:** ready | **Owner:** implementer | **Phase:** E
**Depends on:** none | **Existing tickets:** none

Only saved decks can be copied or downloaded, so an anonymous player ends a round with no way to take the list to the table.

**Read:**
- `web/components/deck/journey/review-phase.tsx`
- `web/components/decks/deck-export.tsx` (copy behaviour and labels to reuse)
- `web/components/deck/journey/use-deck-journey.ts` (`resultText`, signature only)
- `web/components/deck/deck-tool.tsx` (where `ReviewPhase` gets its props, near line 675)

**Write scope:**
- `web/components/deck/journey/review-phase.tsx`
- `web/components/decks/deck-export.tsx` (only to extract the copy button for reuse)
- New files allowed: none

**Approved changes:** copy and text download of the round's result, client-side.

**Acceptance criteria:**
- [ ] Done shows **Copy decklist** and **Download text** beside Save, working signed out.
- [ ] Both use `journey.resultText()`; the download is a client-side `Blob` named after the commander (`<commander-name>.txt`, filesystem-safe).
- [ ] Copy feedback reuses `DeckExport`'s states and timing (shared, not duplicated).
- [ ] Disabled while `busy` or `stale`, like Save.

**Non-goals:** CSV for unsaved decks, the saved-deck export route.

**Validation:**
- `yarn workspace @mtg/web lint src/components/deck/journey/review-phase.tsx src/components/decks/deck-export.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** `resultText()` can return text that differs from what Save would store.

### UI-051: Readiness and basics on Done

**Status:** draft | **Phase:** E | **Depends on:** UI-010

Readiness per §2 at the top of Done; a basic-land checklist ("12 Plains, 9 Swamp") per D-04; the not-owned and in-another-deck cards listed.

### UI-052: Cost to finish, not deck value

**Status:** draft | **Phase:** E | **Depends on:** UI-010

Done's price row becomes the cost of the not-owned cards (unknown prices counted and named), with total deck value secondary.

### UI-053: Bulk review with undo

**Status:** draft | **Owner:** architect to spec | **Phase:** E | **Depends on:** ARCH-002

Per D-08 and §4, when a step has more than about a dozen decisions, open in list view with select-all and per-card undo.

## Gate

Once every task in the phase is `done`, run these commands in order, then the manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local prerequisites. Set `NEXT_PUBLIC_USE_MOCKS=1` in the invoking shell for build/e2e (PowerShell: `$env:NEXT_PUBLIC_USE_MOCKS='1'`). Build first so e2e cannot test a stale bundle.

```sh
yarn workspace @mtg/web typecheck
yarn workspace @mtg/web lint
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e deck-journey.spec.ts --reporter=dot
```

| Phase | Commands | Manual checks |
|---|---|---|
| E | Commands above | Done: readiness states, basics list, copy and download signed out |
