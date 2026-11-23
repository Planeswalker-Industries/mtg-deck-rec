import { describe, expect, it } from 'vitest';
import type { BuildCard, BuildOrigin, BuildResult, CardId, CardSummary, IsoDateTime, OracleId, RecContext } from '../contract';
import { journeyReducer, startJourney } from './journey';
import { builtBuys, missingSpendUsd, roundBuys, roundSpendUsd, withSpent } from './round-spend';

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

describe('missingSpendUsd', () => {
  const owned = new Map([[20 as CardId, 1], [21 as CardId, 4]]);

  it('prices only the copies the collection lacks, basics and unpriced cards free', () => {
    const entries = [
      { card: card(20, 'Creature', 3), quantity: 2 },
      { card: card(21, 'Instant', 5), quantity: 1 },
      { card: card(22, 'Artifact', 1.25), quantity: 1 },
      { card: card(23, 'Basic Land — Plains', 0.25), quantity: 30 },
      { card: card(24, 'Sorcery', null), quantity: 1 },
    ];
    expect(missingSpendUsd(entries, owned)).toBe(4.25);
  });

  it('counts a card listed twice by its copies together', () => {
    const twice = [
      { card: card(20, 'Creature', 3), quantity: 1 },
      { card: card(20, 'Creature', 3), quantity: 1 },
    ];
    expect(missingSpendUsd(twice, owned)).toBe(3);
  });

  it('is 0 for a deck the collection supplies', () => {
    expect(missingSpendUsd([{ card: card(21, 'Instant', 5), quantity: 4 }], owned)).toBe(0);
  });
});

describe("a built deck's spend", () => {
  // Only what builtBuys reads of a build card: the card and where it came from.
  const built = (summary: CardSummary, origin: BuildOrigin) => ({ card: summary, origin }) as BuildCard;
  const result: Pick<BuildResult, 'groups'> = {
    groups: [
      { category: 'artifact', cards: [built(card(20, 'Artifact', 3), 'pick'), built(card(21, 'Creature', 1.5), 'kept')] },
      { category: 'sorcery', cards: [built(card(22, 'Sorcery', 0.5), 'fill'), built(card(23, 'Land', 2), 'pick')] },
    ],
  };
  const deck = {
    commanders: [1 as CardId],
    cards: [20, 21, 22, 23].map((id) => ({ cardId: id as CardId, quantity: 1, section: 'main' as const })),
  };

  it('counts every picked card without a collection, kept cards apart', () => {
    const state = startJourney(deck, builtBuys(result));
    expect(state.bought.map((c) => c.id)).toEqual([20, 22, 23]);
    expect(roundSpendUsd(state, () => false)).toBe(5.5);
  });

  it('counts only the picks the collection lacks with one', () => {
    const state = startJourney(deck, builtBuys(result));
    expect(roundSpendUsd(state, (id) => id === 20 || id === 23)).toBe(0.5);
    expect(roundBuys(state, (id) => id === 20 || id === 23).map((c) => c.id)).toEqual([22]);
  });

  it("counts basic lands as free, and the round's own buys after the build's", () => {
    const state = {
      ...startJourney(deck, [card(24, 'Basic Land — Forest', 0.3), ...builtBuys(result)]),
      adds: [card(10, 'Artifact', 2.5)],
    };
    expect(roundBuys(state, () => false).map((c) => c.id)).toEqual([20, 22, 23, 10]);
    expect(roundSpendUsd(state, () => false)).toBe(8);
  });

  it('refunds nothing for a built card cut, and a reset round starts with nothing bought', () => {
    const state = startJourney(deck, builtBuys(result));
    const cut = journeyReducer(state, { type: 'cut', card: card(20, 'Artifact', 3) });
    expect(cut.cuts.map((c) => c.id)).toEqual([20]);
    expect(roundSpendUsd(cut, () => false)).toBe(5.5);
    expect(journeyReducer(cut, { type: 'reset', base: deck }).bought).toEqual([]);
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
