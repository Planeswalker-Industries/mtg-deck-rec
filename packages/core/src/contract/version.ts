/**
 * Version of the frontend/backend contract in this folder. Any change to these types needs a PR that both frontend and
 * backend approve, and bumps this number.
 *
 * v1 (2026-09-14): frozen at the end of Phase 0, after the deck tool ran on real catalog and deck-corpus data. Changes
 * made during Phase 0 testing, before the freeze: ScoreComponent 'role', CorpusEvidence.scope and CorpusEvidence.limited.
 *
 * v2 (2026-09-14): commander deck lookups. CommanderRequest and CommanderCoverage types, and ActionsApi
 * getCommanderCoverage, requestCommanderDecks and getCommanderRequest.
 */
export const CONTRACT_VERSION = 2;
