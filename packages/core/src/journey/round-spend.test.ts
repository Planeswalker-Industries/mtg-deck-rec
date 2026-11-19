import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, IsoDateTime, OracleId, RecContext } from '../contract';
import { startJourney } from './journey';
import { roundBuys, roundSpendUsd, withSpent } from './round-spend';

const card = (id: number, typeLine: string, usd: number | null): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as OracleId,
  name: `Card ${id}`,
  slug: `card-${id}`,
  manaValue: 2,
  manaCost: '{1}{W}',
  typeLine,
  colorIdentity: 'W',
  images: null,
  gameChanger: false,
  released: true,
  keywords: [],
  price: usd === null ? null : { usd, finish: 'nonfoil', asOf: '2026-11-15T00:00:00Z' as IsoDateTime, source: 'scryfall' },
});

const base = startJourney({ commanders: [1 as CardId], cards: [{ cardId: 2 as CardId, quantity: 1, section: 'main' }] });

describe('roundSpendUsd', () => {
  it('adds up the unowned cards brought in, basics and owned cards free', () => {
    const state = {
      ...base,
      adds: [card(10, 'Artifact', 2.5), card(11, 'Basic Land — Plains', 0.25), card(12, 'Creature', 4)],
      swaps: [{ target: card(2, 'Instant', 1), replacement: card(13, 'Instant', 0.1) }],
      fixes: [{ line: 'curve', in: card(14, 'Sorcery', 0.2), out: card(15, 'Sorcery', 9) }],
    };
    expect(roundSpendUsd(state, () => false)).toBe(6.8);
    expect(roundSpendUsd(state, (id) => id === 12)).toBe(2.8);
  });

  it('is 0 for a round that brought nothing in', () => {
    expect(roundSpendUsd(base, () => false)).toBe(0);
  });
});

describe('roundBuys', () => {
  it('lists the unowned copies brought in, in the order taken, unpriced ones included', () => {
    const state = {
      ...base,
      adds: [card(10, 'Artifact', 2.5), card(11, 'Basic Land — Plains', 0.25), card(12, 'Creature', null)],
      swaps: [{ target: card(2, 'Instant', 1), replacement: card(13, 'Instant', 0.1) }],
      fixes: [{ line: 'curve', in: card(14, 'Sorcery', 0.2), out: card(15, 'Sorcery', 9) }],
    };
    expect(roundBuys(state, (id) => id === 14).map((c) => c.id)).toEqual([10, 12, 13]);
  });
});

describe('withSpent', () => {
  const context: RecContext = {
    deck: base.base,
    bracket: 3,
    bracketSource: 'user',
    includeGameChangers: true,
    ownership: null,
    budget: { cardCapUsd: 5, spendLeftUsd: 20 },
  };

  it('takes the spend off the money left, never below 0', () => {
    expect(withSpent(context, 6.8).budget).toEqual({ cardCapUsd: 5, spendLeftUsd: 13.2 });
    expect(withSpent(context, 25).budget).toEqual({ cardCapUsd: 5, spendLeftUsd: 0 });
  });

  it('leaves a context without a spend budget as it is', () => {
    const capOnly = { ...context, budget: { cardCapUsd: 5 } };
    expect(withSpent(capOnly, 6)).toBe(capOnly);
    expect(withSpent(null, 6)).toBeNull();
  });
});
