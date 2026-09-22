import type { CardSummary, IsoDateTime } from '../contract';
import { groupDeck, type DeckEntry } from '../scoring/deck-groups';

/** The mana curve's last bar collects everything at this mana value or above, as deckbuilders usually draw it. */
export const CURVE_TOP_MANA_VALUE = 7;

export interface DeckStats {
  /** Copies, commanders included when they were passed in. */
  cards: number;
  lands: number;
  /** Average mana value of the nonland cards, 0 when there are none. */
  averageManaValue: number;
  /** Nonland copies per mana value, index = mana value; the last bar counts CURVE_TOP_MANA_VALUE and above. */
  curve: number[];
  /** Copies per card type, in decklist order. */
  types: { label: string; count: number }[];
  gameChangers: number;
  /** Sum of the known reference prices, per copy. */
  priceUsd: number;
  /** Copies with no price, so a total can say it is incomplete. */
  unpriced: number;
  /** The newest price date among the cards, for the as-of line every price needs. */
  priceAsOf: IsoDateTime | null;
}

const isLand = (card: CardSummary) => /\bLand\b/.test(card.typeLine.split(' // ')[0] ?? card.typeLine);

/** Figures a deck review compares before and after: size, curve, card types, Game Changers and price. */
export function deckStats(entries: readonly DeckEntry[]): DeckStats {
  const curve: number[] = Array.from({ length: CURVE_TOP_MANA_VALUE + 1 }, () => 0);
  let cards = 0;
  let lands = 0;
  let manaValueTotal = 0;
  let gameChangers = 0;
  let priceUsd = 0;
  let unpriced = 0;
  let priceAsOf: IsoDateTime | null = null;

  for (const { card, quantity } of entries) {
    cards += quantity;
    if (card.gameChanger) gameChangers += quantity;
    if (card.price) {
      priceUsd += card.price.usd * quantity;
      if (priceAsOf === null || card.price.asOf > priceAsOf) priceAsOf = card.price.asOf;
    } else {
      unpriced += quantity;
    }
    if (isLand(card)) {
      lands += quantity;
      continue;
    }
    const bar = Math.min(CURVE_TOP_MANA_VALUE, Math.max(0, Math.floor(card.manaValue)));
    curve[bar] = (curve[bar] ?? 0) + quantity;
    manaValueTotal += card.manaValue * quantity;
  }

  const nonland = cards - lands;
  return {
    cards,
    lands,
    averageManaValue: nonland > 0 ? manaValueTotal / nonland : 0,
    curve,
    types: groupDeck(entries, 'type').map((g) => ({ label: g.label, count: g.count })),
    gameChangers,
    priceUsd,
    unpriced,
    priceAsOf,
  };
}
