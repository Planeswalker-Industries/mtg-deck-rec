import type { CardCategory, CardId, CardSummary, IsoDateTime } from '../contract';
import type { DeckCoverage } from '../collection/coverage';
import { isBasicLand } from '../journey/builder';
import { cardCategory } from '../scoring/add';
import { ADD_CATEGORIES } from '../scoring/rank';
import type { CartLine } from './tcgplayer';

/** Totals add whole cents, so a long list doesn't drift by float error. */
const CENTS_PER_USD = 100;

// The shopping list on Finish and the saved deck page (T090): the cards a deck still needs, grouped by type, with an
// estimated total. Pure, so the web app only renders it.

export interface ShoppingLine {
  card: CardSummary;
  quantity: number;
}

export interface ShoppingGroup {
  category: CardCategory;
  lines: ShoppingLine[];
}

export interface ShoppingListInput {
  /** The deck as it stands, commanders included, in deck order. */
  entries: readonly ShoppingLine[];
  /** Copies the viewer's collection doesn't supply, per card. Null without a collection. */
  missing: ReadonlyMap<CardId, number> | null;
  /** Cards the round put in, best first. Empty where there is no round (a saved deck page). */
  roundIds: readonly CardId[];
  /** Without a collection: only the round's cards, or the whole deck. Ignored with `missing`. */
  scope: 'round' | 'deck';
}

export interface ShoppingList {
  groups: ShoppingGroup[];
  /** Copies to buy, unpriced ones included. */
  count: number;
  /** Estimated total of the priced copies. */
  totalUsd: number;
  /** Copies with no price, left out of the total. */
  unpriced: number;
  /** The newest price date among the lines; null when none has a price. */
  asOf: IsoDateTime | null;
}

/** Copies the collection doesn't supply, per card: only 'missing' allocations (a copy held by another deck is owned). */
export function missingFromCoverage(coverage: DeckCoverage): Map<CardId, number> {
  const missing = new Map<CardId, number>();
  for (const card of coverage.cards) {
    const quantity = card.allocations.reduce((n, a) => (a.status === 'missing' ? n + a.quantity : n), 0);
    if (quantity > 0) missing.set(card.cardId, quantity);
  }
  return missing;
}

/**
 * The cards to buy. With a collection, the copies it doesn't supply; without one, the round's cards or the whole deck.
 * Basic lands are never listed. Groups follow the Add step's type order; inside a group the round's cards come first,
 * best first, then the rest in deck order.
 */
export function shoppingList({ entries, missing, roundIds, scope }: ShoppingListInput): ShoppingList {
  const round = new Map(roundIds.map((id, i) => [id, i]));
  const lines = entries.flatMap((entry, deckIndex) => {
    if (isBasicLand(entry.card)) return [];
    const quantity = missing ? (missing.get(entry.card.id) ?? 0) : scope === 'deck' || round.has(entry.card.id) ? entry.quantity : 0;
    return quantity > 0 ? [{ card: entry.card, quantity, deckIndex }] : [];
  });
  const rank = (l: { card: CardSummary; deckIndex: number }) => round.get(l.card.id) ?? roundIds.length + l.deckIndex;
  lines.sort((a, b) => rank(a) - rank(b));

  const groups = ADD_CATEGORIES.flatMap((category): ShoppingGroup[] => {
    const inGroup = lines.filter((l) => cardCategory(l.card.typeLine) === category);
    return inGroup.length > 0 ? [{ category, lines: inGroup.map(({ card, quantity }) => ({ card, quantity })) }] : [];
  });

  let count = 0;
  let totalCents = 0;
  let unpriced = 0;
  let asOf: IsoDateTime | null = null;
  for (const { card, quantity } of lines) {
    count += quantity;
    if (!card.price) {
      unpriced += quantity;
      continue;
    }
    totalCents += Math.round(card.price.usd * CENTS_PER_USD) * quantity;
    if (asOf === null || card.price.asOf > asOf) asOf = card.price.asOf;
  }
  return { groups, count, totalUsd: totalCents / CENTS_PER_USD, unpriced, asOf };
}

/** The list's lines in list order, as the cart links take them: every Buy for the list sends these. */
export function cartLines(list: ShoppingList): CartLine[] {
  return list.groups.flatMap((g) => g.lines.map((l) => ({ name: l.card.name, quantity: l.quantity })));
}

/**
 * What the TCGplayer cart will hold, in dollars: every line of the list, whatever number of carts it splits into, basic
 * lands only where the list lists them (never). The one total every surface of a round shows (the docked Deck stats bar,
 * the Budget line, the list's heading), so they agree with what Buy sends.
 */
export function cartTotal(list: ShoppingList): number {
  return list.totalUsd;
}
