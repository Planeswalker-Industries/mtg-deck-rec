# UI overhaul — Phase F — Navigation and polish

Ids are stable and never reused. `UI-` tasks are implementation; `ARCH-` tasks are architectural decisions written into the draft tasks they unblock. Decisions (D-xx) and open questions (Q-xx): [`../DECISIONS.md`](../DECISIONS.md). Design rules (§n): [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). State: [`../STATE.md`](../STATE.md).

All paths are from the repo root; `web/` means `apps/web/src/`. Every validation command runs from the repo root.

### UI-060: Collection in the main navigation

**Status:** ready | **Owner:** implementer | **Phase:** F
**Depends on:** none | **Existing tickets:** none

Collections work signed out (in the browser), yet the nav hides "Your collection" from signed-out players and gives "Rate cards" a top-level slot.

**Read:**
- `web/components/layout/main-nav.tsx` (`NAV_ITEMS`)
- `web/components/layout/site-footer.tsx`
- `apps/web/e2e/home.spec.ts` (nav assertions, if any)

**Write scope:**
- `web/components/layout/main-nav.tsx`
- `web/components/layout/site-footer.tsx`
- `apps/web/e2e/home.spec.ts` (only if it asserts the nav)
- New files allowed: none

**Approved changes:** nav items and order; a footer link.

**Acceptance criteria:**
- [ ] Main nav, in order: **My collection** (`/collection`, everyone, hint "The cards you own"), **Improve a deck** (`/deck`, hint "Cuts, adds and swaps from your cards"), **My decks** (`/decks`, signed in only).
- [ ] "Rate cards" leaves the main nav and appears in the footer as a `TEXT_LINK`, "Help rate card swaps".
- [ ] The phone menu shows the same items with their hints.

**Non-goals:** a "Build a deck" item (UI-061 decides once UI-041 exists).

**Validation:**
- `yarn workspace @mtg/web lint src/components/layout/main-nav.tsx src/components/layout/site-footer.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** `/collection` redirects signed-out visitors somewhere (proxy or page).

### UI-061: Homepage tells the truth

**Status:** ready | **Owner:** implementer | **Phase:** F
**Depends on:** none | **Existing tickets:** none

The homepage promises more than the app does (D-10), and the "new commander" situation sends players to the paste box.

**Read:**
- `web/app/page.tsx` (hero near line 133, closing band near line 90, the hero paragraph)
- `web/components/home/how-it-works.tsx` (`HOW_IT_WORKS_HEADING`)
- `web/components/home/situations.tsx`
- `web/app/layout.tsx` (site description near line 38)
- `web/lib/constants.ts` (`BUILD_DECK_HREF`)
- `apps/web/e2e/home.spec.ts`

**Write scope:**
- `web/app/page.tsx`
- `web/components/home/how-it-works.tsx`
- `web/components/home/situations.tsx`
- `web/app/layout.tsx`
- `apps/web/e2e/home.spec.ts` (only assertions on changed text)
- New files allowed: none

**Approved changes:** copy below; the commander situation's link; single-tap on touch.

**Acceptance criteria:**
- [ ] Hero heading: "Build Commander decks" / "with the cards you already own." (same two-span structure).
- [ ] Hero paragraph: "Paste a deck or pick a commander. We suggest cards from your collection first, and show what's worth buying only if you want it."
- [ ] How it works heading: "Your cards first".
- [ ] Closing band: "Your commander." / "Your cards." / "Your call." (same span structure).
- [ ] Site description: "Build and improve Commander decks from the cards you already own. Import your collection, improve a deck, or start from a commander, and see what's worth buying only when you want to."
- [ ] "Just pulled a cool new Commander!" links to `BUILD_DECK_HREF`.
- [ ] Situation cells navigate on the first tap on touch (remove the tap-to-turn state); hover and focus still turn them.

**Non-goals:** layout, art, the How it works recordings (UI-064).

**Validation:**
- `yarn workspace @mtg/web lint src/app/page.tsx src/components/home/how-it-works.tsx src/components/home/situations.tsx src/app/layout.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** the copy lives in more places than these (e.g. Open Graph images or metadata routes).

### UI-062: Labels under the swipe buttons

**Status:** ready | **Owner:** implementer | **Phase:** F
**Depends on:** none | **Existing tickets:** none

The ✓ / ✕ / ✂ buttons are icon-only; on phones the instructions are screen-reader only (§3).

**Read:**
- `web/components/deck/swipe-rater.tsx` (`SideButton`, its two uses near lines 420 and 430)
- `web/components/deck/journey/single-swipe.tsx` (its use of `SideButton`, the accept/pass labels)
- `web/components/deck/journey/cut-phase.tsx`, `add-phase.tsx` (what they pass to `SingleSwipe`)

**Write scope:**
- `web/components/deck/swipe-rater.tsx`
- `web/components/deck/journey/single-swipe.tsx`
- `web/components/deck/journey/cut-phase.tsx`, `add-phase.tsx` (pass short labels only)
- New files allowed: none

**Approved changes:** a `caption` prop on `SideButton`, short labels passed down.

**Acceptance criteria:**
- [ ] Each side button shows a `text-xs` visible caption below it: Swap / Skip (swap), Cut / Keep (cut), Add / Skip (add); rater mode: Good fit / Not a fit.
- [ ] `aria-label`s unchanged.
- [ ] The caption sits inside the button's grid column, so the card's height and the row's height don't change.

**Non-goals:** the gestures, the phase intros.

**Validation:**
- `yarn workspace @mtg/web lint src/components/deck/swipe-rater.tsx src/components/deck/journey/single-swipe.tsx src/components/deck/journey/cut-phase.tsx src/components/deck/journey/add-phase.tsx`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** `SideButton` is used elsewhere with a layout the caption would break.

### UI-063: Deck stats in plain words

**Status:** ready | **Owner:** implementer | **Phase:** F
**Depends on:** none | **Existing tickets:** T072 (level word)

"Mild 6/8" doesn't say what to do (§7).

**Read:**
- `web/components/deck/deck-stats/level.tsx` (`LevelBadge`)
- `web/components/deck/deck-stats/deck-stats-footer.tsx`, `deck-stats-rail.tsx` (where the badge shows)
- `apps/web/e2e/deck-stats.spec.ts` (line 27)

**Write scope:**
- `web/components/deck/deck-stats/level.tsx`
- `apps/web/e2e/deck-stats.spec.ts`
- New files allowed: none

**Approved changes:** the badge's words.

**Acceptance criteria:**
- [ ] All in line: icon + "All in line". Otherwise icon + "N to review" (N = total − okCount), coloured by level as today.
- [ ] The screen-reader text says the same ("N of M to review").
- [ ] The e2e assertion matches the new words.

**Non-goals:** the panel rows, T072's other items.

**Validation:**
- `yarn workspace @mtg/web lint src/components/deck/deck-stats/level.tsx e2e/deck-stats.spec.ts`
- `yarn workspace @mtg/web typecheck`

**Stop and report if:** the level word is read anywhere else (search `LEVEL[` once and report).

### UI-064: Re-record How it works

**Status:** draft | **Owner:** owner | **Phase:** F | **Depends on:** phases C–E | **Existing tickets:** T049

## Gate

Once every task in the phase is `done`, run these commands in order, then the manual checks below. Use local Supabase credentials; see [CI](../../../.github/workflows/ci.yml) for the mock-build environment and [testing](../../reference/testing.md) for local data and account prerequisites. Set `NEXT_PUBLIC_USE_MOCKS=1` in the invoking shell for build/e2e (PowerShell: `$env:NEXT_PUBLIC_USE_MOCKS='1'`). Build first so e2e cannot test a stale bundle. Record any auth/local-data skips as skips, not passing authenticated or real-data coverage.

```sh
yarn typecheck
yarn lint
yarn test
# Mock environment
yarn workspace @mtg/web build
yarn workspace @mtg/web e2e --reporter=dot
```

| Phase | Commands | Manual checks |
|---|---|---|
| F | Commands above | Homepage, nav and swipe captions at both sizes |

## Follow-ups

Follow-up **UI-090 (draft, after Phase A):** `web/components/decks/deck-visibility.tsx` handles Result failures but not rejected server-action promises; a network failure can leave optimistic visibility wrong. Spec a bounded rollback/error correction and test; do not extend UI-012 to fix it. No dependency for the Phase A gate.
