/**
 * Version of the frontend/backend contract in this folder.
 *
 * v1 was frozen at the end of Phase 0 (2026-09-14), after the deck tool ran on real catalog and deck-corpus data. Any
 * later change to these types needs a PR that both frontend and backend approve, and bumps this number. Changes made
 * during Phase 0 testing, before the freeze: ScoreComponent 'role' (cards to add), CorpusEvidence.scope (commander vs
 * color-wide play rates) and CorpusEvidence.limited (cards too new to judge).
 */
export const CONTRACT_VERSION = 1;
