# Decisions

Product decisions for the UI overhaul. Each is settled unless the owner reopens it; tasks cite them by id. Open questions at the end block the tasks named beside them.

## Settled (owner, 2026-10-09)

- **D-01 Who it's for.** Players who own a pile of cards and know Commander: they want usable decks without shopping. Not a tutorial for new players, not a power-user tool.
- **D-02 Success.** The player leaves with a deck they can assemble from their cards. Finishing a sequence of recommendation screens is not success.
- **D-03 Adapting an online list builds the best owned deck.** The pasted list fixes the commander and seeds the build; the result is the best deck the collection makes for that commander, not a card-for-card copy. Show what changed against the list.
- **D-04 Basic lands are assumed.** Every player is assumed to have ordinary basic lands. They never count as missing, and every finished deck lists the basics to gather by type and count.
- **D-05 When the collection falls short, offer three choices.**
  1. **Continue anyway:** build the best legal 100 from owned cards, filling with weaker owned cards where needed, after a short warning naming the important pieces it had to compromise on.
  2. **Swap commander:** a list of owned commanders the collection supports better.
  3. **Add singles:** the usable owned core, plus a separate, optional list of cards to buy to finish it. Prices unknown to us show as unknown (placeholder), never as zero.
- **D-06 Saving a deck never changes the collection.** Recording cards as owned is a separate, explicit action.
- **D-07 Collection journeys default to owned only.** Purchases appear only in a separate, clearly optional list (the buy list). Owned first stays available as a choice.
- **D-08 Swiping is optional.** Bulk decisions (many missing cards, a whole build) are reviewed as a list with undo; swiping is a way to look at one card at a time.
- **D-09 Low play rate is not "wrong".** A card is called a problem only for a rule (legality, colours, bracket). Low play rate reads as "rarely played with this commander", never as working against the deck.
- **D-10 No claims the product can't keep.** No "make any commander compete", "no singles necessary" or "strongest decks". Promise what is true: decks from your cards, purchases only if you want them.

## Architecture decisions (2026-10-09)

### ARCH-001 / Q-03 — Whole-deck coverage

- **A separate server action, not `DeckAnalysis`.** `ActionsApi.getDeckCoverage({ deck, ownership })` returns `Result<DeckCoverageResult>`. Ownership is required; no collection means no request and no ownership claim. Coverage is private, uncached and independent of recommendation mode, bracket and scoring. The action uses the authenticated client's existing `accountCollectionCopies` / `my_card_availability(deckId)` for an account; browser input uses `sessionCopies`. Never accept a user id or built-deck rows from the caller. Twins and card metadata are server reads. No migration is needed. Additive contract v27, real implementation and mocks together; frontend/backend approval remains required before a release PR merges.
- **One pure allocator:** `deckCoverage(deck, collection, twinGroups, basicLandIds)` in `@mtg/core/collection`. Count commanders once from `deck.commanders` plus main entries only (not commander entries again, sideboard or maybeboard). Fold repeated main entries, sort target ids ascending. Output `{ total, owned, standIn, basic, conflict, missing, cards }`, where each card is `{ cardId, quantity, allocations }`. Allocations are positive quantities of `{ status: 'owned', quantity }`, `{ status: 'stand-in', quantity, sourceCardId }`, `{ status: 'basic', quantity }`, `{ status: 'conflict', quantity, sourceCardId, decks: DeckConflict[] }` or `{ status: 'missing', quantity }`. Totals count copies, not distinct names, and partition `total`; `owned` means exact free copies, not the combined available subtotal.
- **Never spend a copy twice.** Basic lands consume no inventory and are assumed available. For every other source card, free = max(owned − held in other built decks, 0), held = min(owned, sum held). Allocate exact free copies for *all* target cards first, then remaining free twins (most remaining free copies, ties lowest id). Only then allocate conflicts, exact held copies for all targets before held twins (most remaining held, ties lowest id). Decrement the relevant source pool after every allocation; anything left is missing. A conflict lists only built decks containing its source id, sorted by deck id. No conflicts when the collection owns zero copies, even if a built list names the card. Input maps and arrays remain unchanged. This is inventory reporting, not a legality check or a rewrite to twin card names.
- **Wire result:** `DeckCoverageResult` contains the allocation result as `coverage` and `cards: CardSummary[]` for the deck targets and sources actually used as stand-ins/conflicts. Unknown/deleted target or allocated source metadata fails the read; never silently drop it or call it owned. `basicLandIds` is derived from catalog `is_basic_land`, never supplied by the browser. Ordinary and snow basics already identified by the catalog retain the existing basic-land assumption; no new scoring rule.
- **Refresh against the live deck.** Upgrade uses `journey.deck` (working deck), not the original analysis; every applied cut/add/swap/undo changes its request key. Browser quantities come from `ownedCounts(rows)`, ids sorted with aligned quantities, for both coverage and existing recommendation input. Account requests include the open saved deck id so its own built cards are excluded. Coverage refreshes on collection source replacement (including quantity-only changes), deck-id changes, window focus and explicit retry. Superseded answers are discarded. Clear/hide old counts as soon as their deck/source key no longer matches; failures say unavailable, never zero missing. The first slice shows coverage in Upgrade only: the inline builder has uncommitted edits and must not display stale analysis coverage. Builder and saved-page coverage are follow-ups, not false live claims.
- **Display:** compact second-line trigger `X/Y available` (X = owned + standIn + basic); its accessible name and the sheet spell out all six totals. Do not call assumed basics or twins exact owned copies. Sheet sections use §1's labels, quantities and images; conflicts name the holding decks, twins say `Owned as <name>`, basics say they are assumed. No automatic collection write or readiness/legality claim. Hide zero-count sections. The compact trigger replaces the existing card-count text, not a third bar line; counts and details are available in the sheet.
- **Bounded sequencing:** UI-010 is the pure allocator; UI-013 is the contract/server/mock bridge; UI-011 is the client display. UI-011's spec is complete now, but under the workflow it becomes `ready` only when UI-010 and UI-013 are `done`. This supersedes the initial next-action shorthand asking to mark a dependent task ready before its prerequisites run.

## Open questions

| Id | Question | Blocks | Who |
|---|---|---|---|
| Q-01 | What counts as a deck the collection "can't reasonably make"? Proposed: more than N open slots after the build, or any role in `deck_role_targets` short by more than M, with N and M in `app_config.scoring.build`. | ARCH-003 | architect proposes, owner approves |
| Q-02 | How to rank "commanders your collection supports better": run a build per owned commander (expensive), or a SQL score over each commander's stored pool against owned cards? | ARCH-003 | architect |
| Q-04 | Adapt flow: `recs.build` keeping the list's owned cards, or a missing-card step with owned swaps per card? D-03 favours the build. | ARCH-002 | architect |
| Q-05 | Export instructions for ManaBox, Moxfield, Archidekt and TCGplayer must match each app today; who verifies the steps? | UI-023 | owner |
