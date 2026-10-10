# Design rules for the overhaul

Visual tokens, type scale, colour meaning, touch targets and the phone swipe budget are in [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md) ("UI") and are not repeated here. This file adds the rules the overhaul needs. Tasks cite sections by number.

## 1. Ownership vocabulary

One word per state, the same on every screen. Status chips are neutral (not blue: they aren't pressable) and always have text, never colour alone.

| State | Label | Meaning |
|---|---|---|
| owned | **Owned** | A free copy is in the collection |
| conflict | **In another deck** (+ deck names in detail views) | Every copy sits in a deck marked built |
| stand-in | **Owned as <twin name>** | A rules-identical twin is owned and stands in |
| basic | **Basic land** | Assumed available (D-04); never "missing" |
| missing | **Not owned** | No copy, no stand-in |

Unknown price: "Price unknown". Never "$0.00".

## 2. Readiness

A deck's readiness, shown on Done and on deck pages once coverage exists:

- **Ready to assemble:** 100 cards, legal, every nonbasic card owned or stood in, nothing in another deck.
- **Playable with compromises:** ready to assemble, but the build had to go below its quality floor or roles are short; the compromises are listed.
- **Incomplete:** cards missing, in another deck, or the deck isn't 100 cards. Say how many and which.

A full card count alone is never "ready".

## 3. Choices and buttons

- Button text says what happens: "Save deck", "Add 12 cards to my collection", "Replace my collection". No "OK", no bare "Done" for an action.
- The primary button is the safe, expected action. Anything that changes the collection, replaces data or spends money is a secondary button with explicit wording.
- Icon-only buttons on decision controls (✓, ✕, ✂) also show a short visible label below them on phones.

## 4. Lists before swipes

- More than about a dozen decisions of the same kind: show a list with select-all, per-card undo and a running count. Swipe stays available through the existing view toggle.
- Every applied change can be undone from where it shows.

## 5. Buy lists

- Only where the player asked for them (owned only mode, Add singles). Always titled as optional: "Worth buying (optional)".
- Each row: card, why it beats what's owned, price with as-of date or "Price unknown". The total is "cost to finish", not deck value.

## 6. Empty states

Say why the list is empty and what to do next, in one line each. Use the server's reason (`SwapResult.emptyReason` and the like) when one exists; never a generic "nothing found" over a known cause.

## 7. Copy

- Plain words, no scoring jargon ("play rate in N decks", not "synergy score").
- Low play rate: "Rarely played with this commander" (D-09). Rule problems name the rule.
- Estimates say so ("estimated", "about").
- Counts against typical decks: "Typical for <commander> decks: 10", not "target".

## 8. Checks for any screen change

- 390×844 and 1440×900, with the Deck stats dock where it applies; ✓ and ✕ stay on screen without scrolling in swipe view.
- Loading, empty and error states exist and say what's happening.
- Keyboard: every action reachable, focus visible.
