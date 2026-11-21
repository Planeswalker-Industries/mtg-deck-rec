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

  it('leaves out a pair seen only in decks dated before its release month', () => {
    // Card 11 comes out in June, but ten January decks ran it with 10 (previews): no deck from June on runs either card,
    // so the lift would divide by zero.
    const previews = Array.from({ length: 10 }, () => ({ cardIds: [1, 10, 11], month: '2026-01' }));
    const june = Array.from({ length: 10 }, () => ({ cardIds: [1, 20], month: '2026-06' }));
    const release = (id: number) => (id === 11 ? '2026-06' : null);
    const rows = keyPairs([...previews, ...june], release, SETTINGS);
    expect(rows.every((r) => Number.isFinite(r.lift))).toBe(true);
    expect(rows.map((r) => [r.cardA, r.cardB])).not.toContainEqual([10, 11]);
  });

  it("doesn't count preview decks toward a pair (T094)", () => {
    // Ten January decks ran 10 and 11 before 11's June release: only the June decks count, for the pair as for its cards.
    const previews = Array.from({ length: 10 }, () => ({ cardIds: [1, 10, 11], month: '2026-01' }));
    const june = decks.map((d) => ({ ...d, month: '2026-06' }));
    const release = (id: number) => (id === 11 ? '2026-06' : null);
    const [row] = keyPairs([...previews, ...june], release, SETTINGS);
    expect(row).toMatchObject({ cardA: 10, cardB: 11, pairDecks: 10 });
    expect(row?.lift).toBeCloseTo(pairLift(10, 10, 10, 30, 10));
  });

  it('never counts more decks for a pair than for either of its cards (T094)', () => {
    // Every third card comes out in a later month; decks run cards by a fixed pattern across six months.
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    const release = (id: number) => (id % 3 === 0 ? (months[id % months.length] ?? null) : null);
    const mixed = Array.from({ length: 120 }, (_, x) => ({
      cardIds: [2, 3, 5, 6, 7, 9, 12].filter((id) => (x * id) % 4 !== 0),
      month: months[x % months.length] as string,
    }));
    const rows = keyPairs(mixed, release, { ...SETTINGS, liftFloor: 0.01 });
    expect(rows.length).toBeGreaterThan(0);
    const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);
    for (const r of rows) {
      const from = later(release(r.cardA), release(r.cardB));
      const counted = mixed.filter((d) => from === null || d.month >= from);
      const decksOf = (id: number) => counted.filter((d) => d.cardIds.includes(id)).length;
      expect(r.pairDecks).toBeLessThanOrEqual(Math.min(decksOf(r.cardA), decksOf(r.cardB)));
      expect(r.pairDecks).toBe(counted.filter((d) => d.cardIds.includes(r.cardA) && d.cardIds.includes(r.cardB)).length);
    }
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
