import { describe, expect, it } from 'vitest';
import type { BuySwapSuggestion, CardId, CardSummary, IsoDateTime, OracleId, SwapResult } from '../contract';
import { pickUpgrades } from './upgrades';

const AS_OF = '2026-11-15T00:00:00Z' as IsoDateTime;

const card = (id: number, name: string, usd: number | null = null): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as OracleId,
  name,
  slug: name.toLowerCase(),
  manaValue: 2,
  manaCost: '{1}{W}',
  typeLine: 'Creature',
  colorIdentity: 'W',
  images: null,
  gameChanger: false,
  released: true,
  keywords: [],
  price: usd === null ? null : { usd, finish: 'nonfoil', asOf: AS_OF, source: 'scryfall' },
});

// Only what the pick reads: the card, its gain and its value score.
const buy = (c: CardSummary, gain: number): BuySwapSuggestion =>
  ({ card: c, gain, valueScore: c.price ? gain / c.price.usd : null }) as BuySwapSuggestion;

const swap = (target: CardSummary, buyList: BuySwapSuggestion[] | undefined): SwapResult =>
  ({ target, suggestions: [], ...(buyList ? { buyList } : {}) }) as unknown as SwapResult;

const weakA = card(1, 'Weak A');
const weakB = card(2, 'Weak B');
const weakC = card(3, 'Weak C');

describe('pickUpgrades', () => {
  it('keeps the best gain per target and ranks by gain', () => {
    const a = card(10, 'A', 1);
    const b = card(11, 'B', 30);
    const c = card(12, 'C', 2);
    // The buy list comes ranked by gain per dollar (a first); the pick is by gain alone.
    const picks = pickUpgrades([swap(weakA, [buy(a, 0.2), buy(b, 0.4)]), swap(weakB, [buy(c, 0.3)])], 5);
    expect(picks.map((p) => [p.card.name, p.target.name])).toEqual([
      ['B', 'Weak A'],
      ['C', 'Weak B'],
    ]);
  });

  it('never picks one card for two targets', () => {
    const x = card(20, 'X', 5);
    const y = card(21, 'Y', 5);
    const picks = pickUpgrades([swap(weakA, [buy(x, 0.5)]), swap(weakB, [buy(x, 0.6), buy(y, 0.2)])], 5);
    expect(picks.map((p) => [p.card.name, p.target.name])).toEqual([
      ['X', 'Weak A'],
      ['Y', 'Weak B'],
    ]);
  });

  it('returns nothing when no buy list has a card', () => {
    expect(pickUpgrades([], 5)).toEqual([]);
    expect(pickUpgrades([swap(weakA, []), swap(weakB, undefined)], 5)).toEqual([]);
  });

  it('cuts the list to the limit', () => {
    const results = [weakA, weakB, weakC].map((t, i) => swap(t, [buy(card(30 + i, `U${i}`, 1), 0.1 * (i + 1))]));
    expect(pickUpgrades(results, 2).map((p) => p.card.name)).toEqual(['U2', 'U1']);
  });
});
