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
 */
export const CONTRACT_VERSION = 7;
