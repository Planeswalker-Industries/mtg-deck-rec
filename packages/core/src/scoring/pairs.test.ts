import { describe, expect, it } from 'vitest';
import { deckAffinity, pairNeighbours, pmiIndex } from './affinity';
import { globalPairs, keyPairs, pairLift, topPartners, type PairSettings } from './pairs';
import { TEST_SCORING } from './test-config';

const SETTINGS: PairSettings = { shrinkAlpha: 10, minSupport: 2, minShare: 0, liftFloor: 1.2, maxPartners: 50, globalMinDecks: 2 };

// Sac outlet and payoff (10, 11) always go together; the staple (1) is in every deck; 20 and 21 are each in half.
const decks = [
  ...Array.from({ length: 10 }, () => ({ cardIds: [1, 10, 11], month: '2026-01' })),
  ...Array.from({ length: 10 }, () => ({ cardIds: [1, 20], month: '2026-01' })),
  ...Array.from({ length: 10 }, () => ({ cardIds: [1, 21], month: '2026-01' })),
];
const always = () => null;

describe('card pairs (T064)', () => {
  it('shrinks lift toward 1 while the evidence is thin', () => {
    expect(pairLift(10, 10, 10, 30, 10)).toBeGreaterThan(1.5);
    expect(pairLift(2, 2, 2, 30, 10)).toBeLessThan(pairLift(20, 20, 20, 300, 10));
    // Independent cards stay at 1 whatever the prior.
    expect(pairLift(25, 50, 50, 100, 10)).toBeCloseTo(1);
  });

  it("keeps a key's cards that go together, and not a staple with everything", () => {
    const rows = keyPairs(decks, always, SETTINGS);
    expect(rows.map((r) => [r.cardA, r.cardB])).toEqual([[10, 11]]);
    expect(rows[0]?.pairDecks).toBe(10);
  });

  it('counts only decks updated after both cards were released', () => {
    // Card 11 came out in June: the ten earlier decks running 10 alone couldn't have run it, so they don't count.
    const later = decks.map((d) => ({ ...d, month: '2026-06' }));
    const earlier = Array.from({ length: 10 }, () => ({ cardIds: [1, 10], month: '2026-01' }));
    const release = (id: number) => (id === 11 ? '2026-06' : null);
    const [row] = keyPairs([...later, ...earlier], release, SETTINGS);
    expect(row?.lift).toBeCloseTo(pairLift(10, 10, 10, 30, 10));
  });

  it('drops pairs under the support or the lift floor', () => {
    expect(keyPairs(decks, always, { ...SETTINGS, minSupport: 11 })).toEqual([]);
    expect(keyPairs(decks, always, { ...SETTINGS, liftFloor: 10 })).toEqual([]);
  });

  it("keeps a pair among either card's strongest", () => {
    const rows = [
      { cardA: 1, cardB: 2, pairDecks: 5, lift: 3 },
      { cardA: 1, cardB: 3, pairDecks: 5, lift: 2 },
      { cardA: 3, cardB: 4, pairDecks: 5, lift: 1.5 },
    ];
    expect(topPartners(rows, 1).map((r) => `${r.cardA}-${r.cardB}`)).toEqual(['1-2', '1-3', '3-4']);
  });

  it('counts the corpus by colour identity, so a card only counts against decks that could run it', () => {
    // Blue cards 10 and 11: the blue decks and the blue-black ones could run them, the black-only decks couldn't.
    const corpus = [
      ...Array.from({ length: 10 }, () => ({ cardIds: [10, 11], identity: 2 })),
      ...Array.from({ length: 20 }, () => ({ cardIds: [5], identity: 6 })),
      ...Array.from({ length: 30 }, () => ({ cardIds: [5], identity: 4 })),
    ];
    const [row] = globalPairs(corpus, (id) => (id === 5 ? 4 : 2), SETTINGS);
    expect(row).toMatchObject({ cardA: 10, cardB: 11, pairDecks: 10 });
    expect(row?.lift).toBeCloseTo(pairLift(10, 10, 10, 30, 10));
  });
});

describe('deck affinity (T064)', () => {
  const lifts = { own: pmiIndex([[10, 11, Math.E]]), global: pmiIndex([[10, 12, Math.E ** 2]]) };
  const settings = TEST_SCORING.affinity;

  it("scores a card by its pairs with the deck's cards, weighted toward the specific ones", () => {
    const weights = new Map([
      [10, { rate: 0.1, keyDecks: 1000 }],
      [1, { rate: 0.9, keyDecks: 1000 }],
    ]);
    const a = deckAffinity(11, [10, 1], lifts, weights, settings);
    const raw = (Math.log(10) * 1 * (1000 / 1050)) / (Math.log(10) + Math.log(1 / 0.9));
    expect(a?.value).toBeCloseTo(raw / (raw + settings.halfValue));
    expect(a?.pairedWith).toEqual([10]);
  });

  it("leans on the corpus's pairs while the commander has few decks", () => {
    const thin = new Map([[10, { rate: 0.1, keyDecks: 0 }]]);
    expect(deckAffinity(12, [10], lifts, thin, settings)?.value).toBeCloseTo(2 / (2 + settings.halfValue));
    expect(deckAffinity(11, [10], lifts, thin, settings)?.value).toBe(0);
  });

  it('is left out when no deck card carries weight', () => {
    expect(deckAffinity(11, [10], lifts, new Map(), settings)).toBeNull();
  });

  it("finds the cards the deck's pairs point to, the key's pairs first", () => {
    expect(pairNeighbours([10], lifts, 5, () => true)).toEqual([12, 11]);
    expect(pairNeighbours([10], lifts, 5, (id) => id !== 12)).toEqual([11]);
  });
});
