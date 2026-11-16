import type { CardId, CardSummary, RecContext } from '../contract';
import { isBasicLand } from './builder';
import type { JourneyState } from './journey';

/**
 * The money a round spends (T091): the prices of the cards it brought in that the player doesn't own, Add's cards,
 * Swap's replacements and Fix's in cards. Basic lands and owned cards cost nothing, and so does a card without a price
 * (a budget never brings one in). Cuts and cards taken out refund nothing; undoing a choice takes it out of the state,
 * and so out of the sum.
 */
export function roundSpendUsd(state: JourneyState, owns: (cardId: CardId) => boolean): number {
  const cards: CardSummary[] = [...state.adds, ...state.swaps.map((s) => s.replacement), ...state.fixes.map((f) => f.in)];
  const cents = cards.reduce((sum, card) => (isBasicLand(card) || owns(card.id) ? sum : sum + Math.round((card.price?.usd ?? 0) * 100)), 0);
  return cents / 100;
}

/**
 * A context with the round's spend taken off its budget: what a request carries part way through a round. Without a
 * spend budget it is the context as given.
 */
export function withSpent<T extends RecContext | null>(context: T, spentUsd: number): T {
  const left = context?.budget?.spendLeftUsd;
  if (context === null || left === undefined || spentUsd === 0) return context;
  return { ...context, budget: { ...context.budget, spendLeftUsd: Math.max(0, Math.round((left - spentUsd) * 100) / 100) } };
}
