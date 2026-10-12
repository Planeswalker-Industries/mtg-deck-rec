# UI overhaul state

Current UI overhaul status and next action. Reworked 2026-10-12 around the four goals below: one short list, worked top to bottom, one item at a time. The phase files in [`tasks/`](tasks/) stay as reference for specs and evidence; their order no longer applies.

## The four goals

Everything here serves one of these, all with the player's own collection:

1. **Fit an online list:** replace the cards of a decklist from the internet with owned cards that do the same job.
2. **Build from an owned commander:** pick a commander the player owns and build a deck for it from the collection.
3. **Sift for replacements:** recreate going through your cards to find solid replacements for what the deck already does (the swipe tool).
4. **Cut toward a weak area:** recreate deciding which cards to cut to shore up an area the deck lacks.

Paste-and-swipe needs no collection and stays the first-visit entry (D-11). The journey suggests uploading a collection where it would help.

## Active list

| # | Item | Goal | Status | Specs |
|---|---|---|---|---|
| 1 | Close out the import race: a stale browser sync never replaces a newer import; account inventory stays visible while a sync is pending or failed | all | done 2026-10-12 | UI-021 in `tasks/phase-b.md` |
| 2 | Restyle the paste-and-swipe deck tool to match the homepage | 3 | done 2026-10-12 | `DESIGN-SYSTEM.md` |
| 3 | Collection prompts in the journey; Collection in the main nav | 1, 2 | next | UI-060 in `tasks/phase-f.md` |
| 4 | Build from an owned commander, then copy or download the deck | 2 | — | UI-040, UI-041 (`tasks/phase-d.md`), UI-050 (`tasks/phase-e.md`) |
| 5 | Fit an online list to the collection (the build, seeded by the pasted list) | 1 | — | UI-045 in `tasks/phase-d.md`, D-03 |
| 6 | Cut toward a weak area: the player names an area, Cut ranks cards for it | 4 | — | new |
| 7 | Restyle the remaining pages (collection, saved decks, the rest) | all | — | `DESIGN-SYSTEM.md` |

`RecsApi.build` (contract v24, `getBuild`) already exists end to end and nothing in the UI calls it yet; items 4 and 5 are mostly UI.

## Done

| Task | Note |
|---|---|
| UI-001 Save never changes the collection | Phase A gate passed 2026-10-10 |
| UI-002 Swap says why it's empty | Phase A |
| UI-003 Honest cut and swap reasons | Phase A |
| ARCH-001, UI-010, UI-013, UI-011 Whole-deck coverage | Phase A; contract v27 still needs frontend and backend approval before a release PR |
| UI-012 Mark a deck built | Phase A |
| UI-020 Start a collection by hand | Phase B |

## Parked

Not deleted; picked up only once items 1–7 are done or the owner asks.

- **Buy side (D-12):** UI-030, UI-031, the buy part of D-05 "Add singles" (UI-043), UI-052. Anything buy-side renders as a placeholder.
- **Collection setup extras:** UI-022 (return after import; in review), UI-023 (export instructions, Q-05), UI-024 (fix unmatched lines).
- **Defaults and finish extras:** UI-032 (owned only by default), ARCH-002, UI-051, UI-053.
- **Polish:** UI-061 – UI-064, UI-090.
- **Scoring tuning:** no further recommendation-quality work unless one of the goals shows bad results.

## Notes

- Owner refocus 2026-10-12: the four goals, buy list shelved, paste-and-swipe stays the entry. Owner asked for items 1–7 to be implemented with check-ins only for clarification.
- Owner clarification (2026-10-10): coverage text overlapping colour icons is acceptable.
- Schema and contract changes are presented to the owner before they are built.
