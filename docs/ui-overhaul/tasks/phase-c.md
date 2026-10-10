# UI overhaul — Phase C — Owned recommendations

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

### UI-030: The buy list in Add

**Status:** ready | **Owner:** implementer | **Phase:** C
**Depends on:** none | **Existing tickets:** T069, T037

In owned only mode the server returns `AddResult.buyList` (unowned cards clearly better than what the collection offers), and nothing shows it (§5, D-07).

**Read:**
- `web/components/deck/journey/use-deck-journey.ts` (the add list: `addFor`, `loadAdd` near line 249, what `journey.add` returns)
- `web/components/deck/journey/add-phase.tsx`
- `packages/core/src/contract/recs.ts` (`AddResult`, `BuyAddSuggestion`)
- `web/components/deck/journey/single-swipe.tsx` (`SwipeDone`)
- `docs/ui-overhaul/DESIGN-SYSTEM.md` §5

**Write scope:**
- `web/components/deck/journey/use-deck-journey.ts` (expose the buy list only)
- `web/components/deck/journey/add-phase.tsx`
- `web/components/deck/journey/buy-list.tsx` (new)
- New files allowed: `web/components/deck/journey/buy-list.tsx`

**Approved changes:** `journey.add.buyList` (the latest add result's buy list without cards already in the working deck or passed on); a buy list section.

**Acceptance criteria:**
- [ ] `BuyList` renders a `<details>` titled "Worth buying (optional) · N", closed by default; each row shows the card (small image, zoomable), its gain in plain words from the suggestion's fields, and the price with as-of date or "Price unknown".
- [ ] Each row has **Add anyway**, which calls the same `accept` as an owned suggestion.
- [ ] List view: the section sits below the suggestions grid. Swipe view: it shows inside the "That's every suggestion" `SwipeDone` and below the swipe card's footer, never between the card and its buttons.
- [ ] Nothing renders when the buy list is absent or empty (owned first, ignore, no collection).
- [ ] Phone: the swipe card's height is unchanged (the section is below the fold).

**Non-goals:** the swap buy list (UI-031), defaults (UI-032).

**Validation:**
- `yarn workspace @mtg/web lint src/components/deck/journey/use-deck-journey.ts src/components/deck/journey/add-phase.tsx src/components/deck/journey/buy-list.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** the buy list's gain fields don't support a plain-words reason, or accepting an unowned card in owned only mode is refused somewhere in the journey reducer.

### UI-031: The buy list when nothing owned fits a swap

**Status:** draft | **Owner:** implementer | **Phase:** C | **Depends on:** UI-002, UI-030

When `emptyReason` is `NOTHING_OWNED_FITS` and `SwapResult.buyList` has cards, the rater's empty state offers "See N cards worth buying" using `BuyList`; picking one swaps it in. Spec after UI-030 lands, reusing its component.

### UI-032: Owned only by default

**Status:** draft | **Owner:** implementer | **Phase:** C | **Depends on:** UI-030, UI-031 | **Existing tickets:** T037

`readCollectionMode` (`web/components/deck/use-deck-tool.ts`) defaults to `"only"`; the deck tool's "Your collection is loaded" line says so; AGENTS.md "Collections" and T037/T069 in `docs/tasks.md` updated. Ready once the buy lists show.

### ARCH-002: Every unowned card gets handled

**Status:** draft | **Owner:** architect | **Phase:** C | **Resolves:** Q-04

In owned only mode an unowned card reaches Swap only if the cut scorer already lists it for play reasons (`packages/core/src/scoring/rank.ts` `rankCuts`, the `limit` slice). Decide how the "improve my deck" round handles every unowned nonbasic card, and how journey 2 (adapt) works per D-03: most likely `recs.build` with the list's owned cards kept (`buildDeck` keeps the context's main cards) and a before/after diff. Consider request counts, the evaluation gate (does anything change ranking?), and contract impact. Output: UI-045 and any round change made `ready`.

## Gate

Once every task in the phase is `done`, run these commands in order, then the manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local prerequisites. Set `NEXT_PUBLIC_USE_MOCKS=1` in the invoking shell for build/e2e (PowerShell: `$env:NEXT_PUBLIC_USE_MOCKS='1'`). Build first so e2e cannot test a stale bundle. For regression, set `NEXT_PUBLIC_USE_MOCKS=0`, `E2E_LOCAL_DATA=1`, and `E2E_MAILPIT_URL=http://127.0.0.1:56324` (or the configured local Mailpit URL); use the local catalog/corpus and private fixtures under `$MTG_DATA_DIR/regression`. Regression is a separate local-data check, not mock evidence. The manual owned-only round needs a real-data build and a real collection.

```sh
yarn workspace @mtg/core vitest run --reporter=dot
yarn workspace @mtg/web typecheck
yarn workspace @mtg/web lint
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e deck-journey.spec.ts deck-tool.spec.ts --reporter=dot
# Switch to local-data environment
yarn workspace @mtg/web regress
```

| Phase | Commands | Manual checks |
|---|---|---|
| C | Mock commands and local regression above | Owned only round end to end with a real collection; buy lists closed by default |
