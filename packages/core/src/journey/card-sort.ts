// packages/core/src/journey/card-sort.ts
import type { CardSummary } from '../contract';
import { COLOUR_ORDER } from './land-search';

/** How a list of cards is ordered on the deck page and the built deck. */
export type CardSort = 'name' | 'cost' | 'color' | 'price';

/** The sorts in the order the menu offers them. */
export const CARD_SORTS: readonly CardSort[] = ['name', 'cost', 'color', 'price'];

/** Mana value first, as a curve reads (owner, 2026-11-16). */
export const DEFAULT_CARD_SORT: CardSort = 'cost';

/** The fields a sort reads. */
export type SortableCard = Pick<CardSummary, 'name' | 'manaValue' | 'colorIdentity' | 'price'>;

/** The five colours a mono-coloured card can be; C never appears in a colour identity. */
const MONO_COLOURS = COLOUR_ORDER.replace('C', '');
/** Buckets after the five mono colours: two or more colours, then none. */
const MULTICOLOR_BUCKET = MONO_COLOURS.length;
const COLORLESS_BUCKET = MULTICOLOR_BUCKET + 1;

const byName = (a: SortableCard, b: SortableCard) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const byCost = (a: SortableCard, b: SortableCard) => a.manaValue - b.manaValue || byName(a, b);

function colourBucket(card: SortableCard): number {
  const [first, ...rest] = [...card.colorIdentity].filter((c) => MONO_COLOURS.includes(c));
  if (first === undefined) return COLORLESS_BUCKET;
  return rest.length > 0 ? MULTICOLOR_BUCKET : MONO_COLOURS.indexOf(first);
}

const byColour = (a: SortableCard, b: SortableCard) => colourBucket(a) - colourBucket(b) || byCost(a, b);

/** Highest price first, so the cards driving the deck's cost lead; unpriced cards (preview sets) last, by name. */
function byPrice(a: SortableCard, b: SortableCard): number {
  if (a.price === null || b.price === null) {
    if (a.price === b.price) return byName(a, b);
    return a.price === null ? 1 : -1;
  }
  return b.price.usd - a.price.usd || byName(a, b);
}

const COMPARATORS: Record<CardSort, (a: SortableCard, b: SortableCard) => number> = {
  name: byName,
  cost: byCost,
  color: byColour,
  price: byPrice,
};

/** A sorted copy of `items`; `cardOf` finds the card in each item. Never changes `items`. */
export function sortCards<T>(items: readonly T[], sort: CardSort, cardOf: (item: T) => SortableCard): T[] {
  const compare = COMPARATORS[sort];
  return [...items].sort((a, b) => compare(cardOf(a), cardOf(b)));
}
