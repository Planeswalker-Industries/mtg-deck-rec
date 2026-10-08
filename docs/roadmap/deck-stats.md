# Deck stats (T045)

The design for how the deck tool and the Deckbuilder show a deck's figures against what decks for its commander usually run. Agreed with the owner on 2026-10-08, section by section. It places the figures for T046 (mana base), T048 (role counts) and the bracket and combo items of T069.

## What it is

A **Deck stats** readout: every measured stat, its value in the deck, its target, and whether it is in line. Fine stats show too, marked with a check, so the player sees the whole picture and not only the problems. It appears in the deck tool (every journey step, Done included) and in the Deckbuilder. Saved deck pages stay as they are: a figure there leads to no action.

## Stats

Each stat is "the deck's count against a target".

| Group | Stats | Target from | Phase |
|---|---|---|---|
| Mana | Lands, Basic lands | `commander_stats.land_count`, `basic_land_count` | P1 |
| Roles | Ramp, Card advantage, Removal, Protection (the `deck_role_targets` roles) | `commander_stats.role_profile` | P1 |
| Curve | One stat over mana value 0 to 7+ | `commander_stats.curve_profile` | P1 |
| Bracket | Fits the chosen bracket (pass or fail) | `estimatedBracket`, `bracketSignals` | P1 |
| Types | Creatures, Instants, Sorceries, Artifacts, Enchantments, Planeswalkers | `commander_stats.type_profile` (new column) | P2 |
| Colour sources | One per colour in the deck's identity | Karsten's thresholds for the deck's pips (T046) | P3 |

The Bracket group also lists the deck's complete combos (`DeckAnalysis.combos`: what each does and its pieces), each crediting and linking Commander Spellbook. Combos are listed, not scored.

## The rule

- **A stat is OK** when its value is within 20% of the target **or** within 1 card of it, whichever is wider. The 1-card floor stops small targets from always failing: a Planeswalker target of 0.4 makes 0 a 100% miss, and the mana value 0 bar's target is 0.08.
- **Curve is one stat**, OK when every bar is within that tolerance. Counted bar by bar, its eight bars would outweigh every other stat.
- **Bracket** is OK when the deck fits the chosen bracket under every rule (`fitsBracket`: Game Changers, mass land denial, extra turns, an extra-turn loop and its complete combos) and no card added this round completes a combo above it.
- **The overall state** comes from the share of OK stats, shown as `ok/total`:
  - every stat OK: **OK**, a check, green
  - half or more OK: **Mild**, a warning sign, gold
  - under half OK: **Urgent**, an exclamation mark, red
- The 20% and the 1 card are display rules, not scoring weights, so they are named constants in `@mtg/core` (coding policy).

## Targets

The server blends each target between the commander's own average and a typical value, by `commanderShare` (`@mtg/core/scoring`, the same share `roleTargetsFor` uses for roles). The client never blends.

- **Typical roles:** `app_config.deck_role_targets`.
- **Typical lands and basic lands:** `app_config.scoring.build.landCounts` and `basicLandCounts`, by the deck's colour count.
- **Typical curve and types:** the deck-weighted average of every `commander_stats` row, computed on read by `typical_deck_profile()` (one SQL function, one jsonb value: PostgREST's row cap would cut a plain select of the ~2,700 rows) and cached per server instance like the other settings. No table holds it.
- **Never EDHREC.** `commander_sets` holds EDHREC role and curve profiles, but a target made from them would display EDHREC's numbers. Call `roleTargetsFor` without the EDHREC prior.
- **The label says whose numbers they are:** "Liesa decks (102)" when the commander's own decks carry the whole target (`commanderShare` 1, source `commander`), "Liesa decks (30), filled out with typical decks" in between (`blended`), "Typical decks" when they have too few to count (`commanderShare` 0, `typical`). The count is the commander's own decks. Partner pooling applies to the share as it does for play rates (borrowed decks at their weight), and when decks were borrowed the label says so: "Tymna & Thrasios decks (12) with partner decks".

## Where it lives

### Phones and tablets: a docked footer

Below `lg` in the deck tool and below `xl` in the Deckbuilder (already two columns at `lg`).

```
collapsed (sticky, about 48 px plus the safe area)
┌────────────────────────────────────────┐
│ Deck stats          ⚠ Mild  5/8    ⌃  │
└────────────────────────────────────────┘
```

- Left: the title. Right: the state's icon, its name, `ok/total` in DM Mono, and a chevron.
- Tapping the bar or swiping up expands it; swiping down or tapping the chevron collapses it. Expanded, it is a sheet over the cards, at most about 75% of the screen tall, scrolling inside. Its drag is vertical and the swipe cards' is horizontal, so they don't compete.
- The collapsed footer's height joins `--swipe-chrome`: the swipe cards shrink by it, and ✓ and ✕ stay on screen at 390×844.

### Wide screens: a side rail, always open

From `lg` in the deck tool and from `xl` in the Deckbuilder: a right-hand column with the same content as the expanded sheet, its header without the chevron. Sticky under the DeckBar (`var(--deck-bar-height,0px)`), scrolling inside.

### The readout

```
Deck stats          ⚠ Mild  5/8
vs Liesa decks (102)
Mana
✓ Lands        ▓▓▓▓▓▓▓▓░|░    34 / 33
⚠ Basic lands  ▓▓▓▓░░|░░      12 / 20   8 short
Roles
⚠ Ramp         ▓▓▓▓▓░|░░       6 / 12   6 short · Find ramp
✓ Card advantage …
Curve ⚠        eight small bars, each with its target tick
Bracket
✓ Fits bracket 3     1 combo (Commander Spellbook)
```

- Groups always come in the same order (Mana, Roles, Curve, Types, Colour sources, Bracket), so the panel reads the same every time.
- Each row: the state icon, the name, a horizontal bar, and `value / target` in DM Mono. The bar shades the target's tolerance band; the value's fill is green when OK and gold when not. An off stat says how far off in words: "6 short", "3 over". Icons and words carry the meaning, never colour alone.
- **Before and after:** in the journey, each bar has a faint tick where the deck stood at the start of the round, so the change shows without a second panel.
- **Done** keeps its before and after columns for Cards, Lands, Average mana value, Game Changers and Price. The curve and card types leave those columns: Deck stats shows them, with the round-start ticks.

### Actions (deck tool only)

- A role or Lands short: a link ("Find ramp", "Find lands") opens Add filtered to that role. Add gains a role filter for it.
- A stat over its target: "Pick cuts" opens Cut.
- Bracket not fitting: opens Cut, where the over-bracket cuts already are.
- Curve and Types have no action yet. In the Deckbuilder the rows only inform.

### Colours

Only the theme's existing status colours, aliased in `globals.css` with no new values:

| Alias | Uses | Value |
|---|---|---|
| `--stat-ok` | `--add` | #8cc49a |
| `--stat-mild` | `--gc` | #e0b354 |
| `--stat-urgent` | `--cut` | #e08a7a |

Mild shares its gold with the Game Changer badge; the two never sit in the same row.

## How it updates

The client keeps a **tally** and changes it by each card that moves; it never recounts the deck after an edit.

- `DeckTally` (`@mtg/core/journey`) holds the counts: lands, basic lands, each tracked role, the eight curve bars, the types, Game Changers, and which pieces of each complete combo are still in the deck.
- `applyCard(tally, card, quantity)` (quantity negative for a cut) changes only what that card touches. Cutting a land lowers Lands, and Basic lands if it is a basic. Adding a 3-mana creature with ramp raises curve bar 3, Creatures and Ramp.
- **Roles never need a recount.** The stats are fixed by the targets, so a card bringing a role the deck lacked moves that role's count from 0 to 1. Roles outside the tracked four are ignored.
- **Grading** compares the tally with the targets (about fifteen comparisons) after each change; it doesn't walk the deck.
- **A full build** happens only when the base changes: a new analysis, Start over, Revert, or the Deckbuilder loading a deck.
- **Bracket mid-round:** a cut piece takes its combo out, a cut Game Changer lowers the count, an added Game Changer raises it, and an add carrying `completesOverBracket` counts against the bracket. The row says "estimated", as the bracket does today; Re-analyze gives the exact answer.
- **Drift guard:** a property test applies random sequences of adds and cuts and checks the tally always equals a full count of the resulting deck.

## Contract and data

**Contract v26:**
- `DeckAnalysis.statTargets`: `source` (`commander`, `blended`, `typical`), `label`, and the blended targets for lands, basic lands, each role (tag id, label, target), the curve (eight values) and, from P2, the types.
- `CardSummary.roles?: string[]`: the tracked role tag ids a card fills. `serving_card` already returns them; analysis loads them for the deck's own cards. Without it, roles can't be counted as cards come and go.
- The mocks gain both.

**Database:**
- P1 adds one function, `typical_deck_profile()`, and no table or column.
- P2 adds one column, `commander_stats.type_profile` (jsonb, average cards per deck by type), written by `apps/worker/src/lib/key-stats.ts` beside `curve_profile`, in the same row write and diff-only. It adds about 0.3 MB to a 3.9 MB table; the next full pass fills it. Typical types come from the same weighted average on read.

## Phases

1. **P1:** `DeckTally`, `applyCard` and grading; the footer and the rail; Lands, Basic lands, Roles, Curve and Bracket with combos; Add's role filter; curve and types leave Done's columns; contract v26. `ok/total` counts 8 stats.
2. **P2:** Types (`type_profile`): 14 stats.
3. **P3:** Colour sources (T046: `produced_mana` in the catalog and Karsten's thresholds), one more per colour.

## Tests

- `@mtg/core`: the 20% and 1-card tolerance at their edges, Curve's every-bar rule, the overall state at exactly half, each delta of `applyCard`, and the property test against a full count.
- SQL (P2): `type_profile` written diff-only, readable by API roles like the other profiles.
- e2e at 390×844: the footer shows, expands and collapses, and ✓ and ✕ stay on screen while it is collapsed.
- Screenshots on a phone and a desktop (`shoot.mjs`).

## Left out on purpose

Salt (never stored), 1–10 power levels and radar charts (invented composites), AI-written text, upsells, legality in other formats, and any EDHREC number.
