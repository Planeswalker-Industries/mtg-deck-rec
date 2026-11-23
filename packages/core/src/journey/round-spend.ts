import type { BuildResult, CardId, CardSummary, RecContext } from '../contract';
import { isBasicLand } from './builder';
import type { JourneyState } from './journey';

/**
 * The money a round spends (T091): the prices of the cards it brought in that the player doesn't own, a built deck's
 * picks (T099), Add's cards, Swap's replacements and Fix's in cards. Basic lands and owned cards cost nothing, and so does a card without a price
 * (a budget never brings one in). Cuts and cards taken out refund nothing; undoing a choice takes it out of the state,
 * and so out of the sum.
 */
export function roundSpendUsd(state: JourneyState, owns: (cardId: CardId) => boolean): number {
  const cents = roundBuys(state, owns).reduce((sum, card) => sum + Math.round((card.price?.usd ?? 0) * 100), 0);
  return cents / 100;
}

/**
 * With a collection (T102): what the deck as it stands still needs bought, the copies the collection lacks, priced. The
 * spend budget caps this, the same money the shopping list and Buy hold, so a deck from the web built from the
 * collection spends from the budget for its missing cards as much as for the cards the round brings in. Basic lands and
 * unpriced cards cost nothing; a card listed twice (a commander also in the main deck) is counted once, by copies.
 */
export function missingSpendUsd(entries: readonly { card: CardSummary; quantity: number }[], owned: ReadonlyMap<CardId, number>): number {
  const byId = new Map<CardId, { card: CardSummary; quantity: number }>();
  for (const { card, quantity } of entries) byId.set(card.id, { card, quantity: (byId.get(card.id)?.quantity ?? 0) + quantity });
  let cents = 0;
  for (const { card, quantity } of byId.values()) {
    if (isBasicLand(card)) continue;
    const lacking = Math.max(0, quantity - (owned.get(card.id) ?? 0));
    cents += lacking * Math.round((card.price?.usd ?? 0) * 100);
  }
  return cents / 100;
}

/**
 * The cards the round brought in that the spend counts, in the order they were taken (the build's, then Add, Swap and
 * Fix): one entry per copy, unowned and not basic lands. Unpriced ones are included; they add nothing to the spend.
 */
export function roundBuys(state: JourneyState, owns: (cardId: CardId) => boolean): CardSummary[] {
  const cards: CardSummary[] = [...state.bought, ...state.adds, ...state.swaps.map((s) => s.replacement), ...state.fixes.map((f) => f.in)];
  return cards.filter((card) => !isBasicLand(card) && !owns(card.id));
}

/**
 * The cards a build bought, to start the round on the built deck with (T099): every card it picked, one copy each.
 * Kept cards were in the deck before the build, and basic lands cost nothing; which picks the player owns is the
 * round's to tell (`roundBuys`), so a collection build's owned picks drop out there.
 */
export function builtBuys(result: Pick<BuildResult, 'groups'>): CardSummary[] {
  return result.groups.flatMap((group) => group.cards.filter((c) => c.origin !== 'kept').map((c) => c.card));
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
