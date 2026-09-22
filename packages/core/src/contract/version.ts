/**
 * Version of the frontend/backend contract in this folder. Any change to these types needs a PR that both frontend and
 * backend approve, and bumps this number.
 *
 * v1 (2026-09-14): frozen at the end of Phase 0, after the deck tool ran on real catalog and deck-corpus data. Changes
 * made during Phase 0 testing, before the freeze: ScoreComponent 'role', CorpusEvidence.scope and CorpusEvidence.limited.
 *
 * v2 (2026-09-14): commander deck lookups. CommanderRequest and CommanderCoverage types, and ActionsApi
 * getCommanderCoverage, requestCommanderDecks and getCommanderRequest.
 *
 * v3 (2026-09-15): partner decks borrowed across pairings. Optional CommanderKeyRef.borrowedDeckCount and
 * CorpusEvidence.pooled. CommanderKeyRef.deckCount now counts only decks with exactly these commanders (a pair used to
 * include each partner's solo decks when it had too few of its own).
 *
 * v4 (2026-09-15): swap votes for the swipe rater. ActionsApi.castVote takes an optional VoteContext (source, sitting,
 * position, candidates shown, matched tags); VoteSummary.myVote also covers signed-out voters.
 *
 * v5 (2026-09-15): the card rater. CatalogApi.searchCards (GET /api/cards/search), ActionsApi.dealRaterCards and
 * RaterDeal.
 *
 * v6 (2026-09-16): saved decks. ActionsApi renameDeck, duplicateDeck and setDeckVisibility, plus optional
 * SavedDeckSummary.bracket. saveDeck, deleteDeck and getMySavedDecks were already in v1 and are unchanged.
 *
 * v7 (2026-09-17): SavedDeckSummary.code, the short random code a deck URL uses. The name is user-written and
 * can change, so it must never appear in the path; `id` stays the key the write actions take.
 *
 * v8 (2026-09-17): the deck workspace groups a deck by card type, keyword and tag. CardSummary.keywords carries
 * Scryfall's rules keywords, and CatalogApi.cardTags returns functional tags per card. Keywords ride on the card
 * because the tool already holds one for every card; tags are fetched separately because most views never need them.
 *
 * v9 (2026-09-17): reopening a saved deck. ActionsApi.openSavedDeck returns SavedDeckContents (the deck as decklist
 * text), and saveDeck takes an optional bracket, so a deck comes back with the bracket it was saved at. saveDeck also
 * returns the deck's code beside its id, so the deck just saved can be linked to and gone on editing; it already
 * accepted a deckId, which is what makes the tool's auto-save an update rather than a new deck.
 *
 * v10 (2026-09-21): the collection view. ActionsApi.getMyCollectionEntries reads the signed-in user's collection back
 * (one CollectionEntry per card), CatalogApi.collectionCards returns those cards with their tag labels and the sets
 * they were printed in (CardSet), and ResolvedCollectionRow carries an optional setCode so a browser collection can be
 * filtered by set too.
 *
 * v11 (2026-09-21): the deck journey (cut, add, replace, review). CutSuggestion.severity splits cards that work against
 * the deck (mandatory: rule problems and severe misfits, dealt in the Cut phase) from weaker fits (suggested, dealt in
 * the Replace phase with a replacement). Mandatory cuts come first in CutResult.suggestions.
 *
 * v12 (2026-09-22): ActionsApi.saveDeck takes an optional `original`, the deck the player brought before the journey
 * changed it. It is kept once per deck, so the deck page can compare the two and put the original back.
 *
 * v13 (2026-09-22): RecContext.ownershipMode. 'first' ranks owned cards ahead of comparable ones without hiding the
 * rest; 'only' (the default when omitted, and what earlier clients meant) keeps suggestions to owned cards.
 *
 * v14 (2026-09-22): the deckbuilder's card search. CatalogApi.searchCards takes CardSearchInput: optional colour
 * identity, card type, mana value and offset, and an empty name when a filter is set (browse by play rate).
 *
 * v15 (2026-09-22): editing a collection by hand. ActionsApi.setCollectionCardQuantity sets a card's total copies in
 * the signed-in user's collection (0 removes it).
 *
 * v16 (2026-09-22): CatalogApi.searchCards takes optional CallOptions, so a search-as-you-type field can abort the
 * calls it has already superseded. Additive and transport-only: it carries no payload, an implementation that ignores
 * it still satisfies the interface, and every existing caller type-checks unchanged.
 */
export const CONTRACT_VERSION = 16;
