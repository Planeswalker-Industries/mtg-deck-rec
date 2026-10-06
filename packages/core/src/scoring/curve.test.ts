import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, IsoDateTime, OracleId, RecContext } from '../contract';
import {
  curveBucket,
  curveMeanManaValue,
  curveOverloaded,
  curveShortfall,
  curveTargets,
  deckCurve,
  isFrontLand,
} from './curve';
import { rankAdds, rankCuts, roleTargetsFor, type CardPlayRates, type RankCard, type RankCorpus } from './rank';
import { TEST_CORPUS_SETTINGS, TEST_SCORING } from './test-config';

describe('the learned curve (T062)', () => {
  it('buckets mana values, everything from 7 up together', () => {
    expect([0, 1, 2.5, 6, 7, 12].map(curveBucket)).toEqual(['0', '1', '2', '6', '7', '7']);
  });

  it('reads a land from the front face only', () => {
    expect(isFrontLand('Land')).toBe(true);
    expect(isFrontLand('Artifact Land')).toBe(true);
    expect(isFrontLand('Instant // Land')).toBe(false);
    expect(isFrontLand('Creature — Elf Druid')).toBe(false);
  });

  it('counts a deck by bucket, lands left out', () => {
    const deck = deckCurve([
      { manaValue: 2, isLand: false },
      { manaValue: 2, isLand: false },
      { manaValue: 0, isLand: true },
      { manaValue: 9, isLand: false },
    ]);
    expect(Object.fromEntries(deck)).toEqual({ '2': 2, '7': 1 });
  });

  it('measures a shortfall against the target and spots an overloaded bucket', () => {
    const targets = { '2': 10, '3': 8 };
    const deck = new Map([
      ['2', 4],
      ['3', 12],
    ]);
    expect(curveShortfall(targets, deck, 2)).toBeCloseTo(0.6);
    expect(curveShortfall(targets, deck, 3)).toBe(0);
    expect(curveShortfall(targets, deck, 5)).toBe(0);
    expect(curveOverloaded(targets, deck, 3, 1.25)).toBe(true);
    expect(curveOverloaded(targets, deck, 2, 1.25)).toBe(false);
    expect(curveMeanManaValue(targets)).toBeCloseTo((2 * 10 + 3 * 8) / 18);
  });

  it('measures against our curve once our decks count, EDHREC before then', () => {
    const ours = { '2': 10 };
    const prior = { roles: {}, curve: { '2': 6 }, evidence: 100 };
    expect(curveTargets(ours, 10, null, TEST_CORPUS_SETTINGS)).toBeNull();
    expect(curveTargets(ours, 10, prior, TEST_CORPUS_SETTINGS)).toEqual({ '2': 6 });
    expect(curveTargets(ours, 200, prior, TEST_CORPUS_SETTINGS)).toEqual({ '2': 10 });
    expect(curveTargets(ours, 200, null, TEST_CORPUS_SETTINGS)).toEqual({ '2': 10 });
  });
});

describe('the skeleton in ranking (T062)', () => {
  const card = (id: number, manaValue: number, typeLine = 'Creature — Elf'): RankCard => {
    const summary: CardSummary = {
      id: id as CardId,
      oracleId: `o-${id}` as OracleId,
      name: `Card ${id}`,
      slug: `card-${id}`,
      manaValue,
      manaCost: '',
      typeLine,
      colorIdentity: 'G',
      images: null,
      gameChanger: false,
      released: true,
      keywords: [],
      price: { usd: 1, finish: 'nonfoil', asOf: '2026-10-06T00:00:00Z' as IsoDateTime, source: 'scryfall' },
    };
    return { summary, colorIdentity: 16, legal: true, isBasicLand: false };
  };
  const rate = (inclusion: number): CardPlayRates => ({
    baseline: 0.05,
    baselineDeckCount: 5000,
    commanderDeckCount: 500,
    commanderRate: { inclusion, synergy: inclusion - 0.05 },
    hasExternalPrior: false,
    evidence: { scope: 'commander', decksWith: 1, commanderDeckCount: 500, inclusionRate: inclusion, synergy: 0, limited: false },
  });
  const corpus: RankCorpus = {
    settings: TEST_CORPUS_SETTINGS,
    confidence: 'full',
    effectiveDeckCount: 500,
    roleProfile: {},
    curveProfile: { '2': 10, '6': 1 },
    prior: { roles: { ramp: 14 }, curve: {}, evidence: 100 },
  };
  const deck = [card(1, 2), card(2, 6), card(3, 6), card(4, 6)];
  const context: RecContext = {
    deck: { commanders: [], cards: deck.map((c) => ({ cardId: c.summary.id, quantity: 1, section: 'main' as const })) },
    bracket: 3,
    bracketSource: 'inferred',
    includeGameChangers: true,
    ownership: null,
  };
  const cards = new Map(deck.map((c) => [c.summary.id as number, c]));

  it('scores the curve component (at weight 0, so the total is unchanged)', () => {
    const pool = [card(10, 2), card(11, 6)];
    const { groups } = rankAdds({
      context,
      poolIds: [10, 11],
      cards: new Map(pool.map((c) => [c.summary.id as number, c])),
      rates: new Map([
        [10, rate(0.5)],
        [11, rate(0.5)],
      ]),
      roles: new Map(),
      corpus,
      roleTargets: [],
      roleTags: new Map(),
      ownedBoost: 0,
      scoring: TEST_SCORING,
      availability: null,
      deckCards: cards,
      limitPerCategory: 10,
    });
    const [two, six] = [10, 11].map((id) => groups.flatMap((g) => g.suggestions).find((s) => s.card.id === id));
    expect(two?.score.components.curve).toBe(0.9);
    expect(six?.score.components.curve).toBe(0);
    expect(two?.score.total).toBe(six?.score.total);
  });

  it('cuts by the curve only once switched on', () => {
    const cutsWith = (curveCuts: boolean) =>
      rankCuts({
        context,
        cards,
        rates: new Map(deck.map((c) => [c.summary.id as number, rate(0.02)])),
        roles: new Map(),
        corpus,
        roleTargets: [],
        scoring: { ...TEST_SCORING, skeleton: { ...TEST_SCORING.skeleton, curveCuts } },
        availability: null,
        limit: 10,
      }).suggestions.filter((s) => s.reasons.includes('HIGH_MANA_VALUE')).length;
    // The fixed rule flags all three 6-drops; the curve agrees here, since the deck runs three where its decks run one.
    expect(cutsWith(false)).toBe(3);
    expect(cutsWith(true)).toBe(3);
    const lean = { ...corpus, curveProfile: { '2': 10, '6': 4 } };
    const leanCuts = rankCuts({
      context,
      cards,
      rates: new Map(deck.map((c) => [c.summary.id as number, rate(0.02)])),
      roles: new Map(),
      corpus: lean,
      roleTargets: [],
      scoring: { ...TEST_SCORING, skeleton: { ...TEST_SCORING.skeleton, curveCuts: true } },
      availability: null,
      limit: 10,
    });
    expect(leanCuts.suggestions.filter((s) => s.reasons.includes('HIGH_MANA_VALUE'))).toHaveLength(0);
  });

  it("moves role targets toward EDHREC's profile only when the prior is on", () => {
    const thin = { ...corpus, effectiveDeckCount: 0 };
    const generic = [{ roleId: 'ramp', label: 'Ramp', target: 10 }];
    expect(roleTargetsFor(generic, thin)[0]?.target).toBe(10);
    expect(roleTargetsFor(generic, thin, true)[0]?.target).toBe(14);
  });
});
