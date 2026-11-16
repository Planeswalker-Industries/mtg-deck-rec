import type { CardSummary } from '../contract/cards';
import type { DeckBudget } from '../contract/decks';
import type { RecBudget } from '../contract/recs';

/**
 * The budget filter every ranker shares (T091). A budget is a choice the player makes, so without one nothing here
 * changes a result.
 */

/** Money in whole cents, so a running total doesn't drift. */
const toCents = (usd: number) => Math.round(usd * 100) / 100;

/**
 * The budget a request carries: the player's card cap as set, and their spend minus what the round has spent, never
 * below 0. Undefined without a budget, so a request without one is the same as before budgets.
 */
export function requestBudget(budget: DeckBudget | undefined, spentUsd = 0): RecBudget | undefined {
  if (budget?.cardCapUsd === undefined && budget?.spendUsd === undefined) return undefined;
  return {
    ...(budget.cardCapUsd === undefined ? {} : { cardCapUsd: budget.cardCapUsd }),
    ...(budget.spendUsd === undefined ? {} : { spendLeftUsd: Math.max(0, toCents(budget.spendUsd - spentUsd)) }),
  };
}

/** The most an unowned card may cost under a budget: the lower of its set fields, or null when none is set. */
export function effectiveCapUsd(budget: RecBudget | undefined): number | null {
  const caps = [budget?.cardCapUsd, budget?.spendLeftUsd].filter((cap): cap is number => cap !== undefined);
  return caps.length === 0 ? null : Math.min(...caps);
}

/**
 * Whether a card may be suggested under the cap. Cards the collection supplies and basic lands always pass, and so does
 * every card without a cap. Under a cap an unpriced card is left out, and a priced one passes at or below it.
 */
export function withinBudget(card: Pick<CardSummary, 'price'>, supplied: boolean, isBasic: boolean, capUsd: number | null): boolean {
  if (supplied || isBasic || capUsd === null) return true;
  if (card.price === null) return false;
  return card.price.usd <= capUsd;
}
