import type { Bracket, CardSummary, CutReason, CutSuggestion } from '../contract';
import { gameChangerLimit } from '../formats/commander/bracket';

/** The rules a bracket sets on a deck: every other rule problem is the same whatever the bracket. */
export type BracketCutReason = Extract<CutReason, 'GAME_CHANGER_EXCLUDED' | 'OVER_BRACKET_GC_LIMIT'>;

export interface BracketMustCut {
  card: CardSummary;
  reason: BracketCutReason;
}

/**
 * The cards a bracket makes must-cuts, from cut suggestions for the deck at that bracket. A bracket that allows no Game
 * Changers makes every one of them a must-cut. A bracket with a limit flags every Game Changer once the deck is over
 * it, but only the excess has to go, so this picks that many, the least played in decks like this one first.
 *
 * Other rule problems (legality, colour identity) don't change with the bracket, so they stay the Cut phase's.
 */
export function bracketMustCuts(suggestions: readonly CutSuggestion[], bracket: Bracket): BracketMustCut[] {
  const excluded = suggestions.filter((s) => s.reasons.includes('GAME_CHANGER_EXCLUDED'));
  if (excluded.length > 0) return excluded.map((s) => ({ card: s.card, reason: 'GAME_CHANGER_EXCLUDED' }));

  const over = suggestions.filter((s) => s.reasons.includes('OVER_BRACKET_GC_LIMIT'));
  const excess = over.length - gameChangerLimit(bracket);
  if (excess <= 0) return [];
  return [...over]
    .sort((a, b) => (a.corpus?.inclusionRate ?? 0) - (b.corpus?.inclusionRate ?? 0))
    .slice(0, excess)
    .map((s) => ({ card: s.card, reason: 'OVER_BRACKET_GC_LIMIT' }));
}
