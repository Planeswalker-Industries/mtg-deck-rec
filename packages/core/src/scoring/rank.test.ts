import { describe, expect, it } from 'vitest';
import { availability, type BuiltDeck } from '../collection/availability';
import type { CardId, CardSummary, DeckId, IsoDateTime, OracleId, RecContext } from '../contract';
import { rankAdds, rankCuts, rankSwaps, type CardPlayRates, type RankCard, type RankCorpus, type SwapPool } from './rank';
import { TEST_CORPUS_SETTINGS, TEST_SCORING } from './test-config';

const WHITE = 1;
const COMMANDER = 100;

function card(id: number, name: string, typeLine: string, usd: number | null = 1): RankCard {
  const summary: CardSummary = {
    id: id as CardId,
    oracleId: `oracle-${id}` as OracleId,
    name,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    manaValue: 2,
    manaCost: '{1}{W}',
    typeLine,
    colorIdentity: 'W',
    images: null,
    gameChanger: false,
    released: true,
    keywords: [],
    price: usd === null ? null : { usd, finish: 'nonfoil', asOf: '2026-10-06T00:00:00Z' as IsoDateTime, source: 'scryfall' },
  };
  return { summary, colorIdentity: WHITE, legal: true, isBasicLand: typeLine.startsWith('Basic') };
}

/** Play rates whose score rises with `inclusion`: the commander's decks run the card that often. */
const rates = (inclusion: number): CardPlayRates => ({
  baseline: 0.05,
  baselineDeckCount: 5000,
  commanderDeckCount: 500,
  commanderRate: { inclusion, synergy: inclusion - 0.05 },
  hasExternalPrior: false,
  evidence: { scope: 'commander', decksWith: Math.round(inclusion * 500), commanderDeckCount: 500, inclusionRate: inclusion, synergy: inclusion - 0.05, limited: false },
});

const corpus: RankCorpus = { settings: TEST_CORPUS_SETTINGS, confidence: 'full', effectiveDeckCount: 500, roleProfile: {} };

const context = (ownershipMode: 'only' | 'first' = 'only', deckCards: number[] = []): RecContext => ({
  deck: {
    commanders: [COMMANDER as CardId],
    cards: deckCards.map((id) => ({ cardId: id as CardId, quantity: 1, section: 'main' as const })),
  },
  bracket: 3,
  bracketSource: 'inferred',
  includeGameChangers: true,
  ownership: { kind: 'account' },
  ownershipMode,
});

const commander = card(COMMANDER, 'Liesa', 'Legendary Creature — Angel');
const ring = card(1, 'Sol Ring', 'Artifact', 2);
const signet = card(2, 'Orzhov Signet', 'Artifact', 0.5);
const vessel = card(3, 'Thought Vessel', 'Artifact', 0.05);
const talisman = card(4, 'Talisman of Hierarchy', 'Artifact', null);
const wilds = card(10, 'Evolving Wilds', 'Land');
const expanse = card(11, 'Terramorphic Expanse', 'Land');
const plains = card(20, 'Plains', 'Basic Land — Plains');
const twins = new Map([
  [wilds.summary.id as number, wilds.summary.id as number],
  [expanse.summary.id as number, wilds.summary.id as number],
]);
const all = [commander, ring, signet, vessel, talisman, wilds, expanse, plains];
const cards = new Map(all.map((c) => [c.summary.id as number, c]));
const playRates = new Map<number, CardPlayRates>([
  [1, rates(0.9)],
  [2, rates(0.5)],
  [3, rates(0.45)],
  [4, rates(0.95)],
  [10, rates(0.6)],
  [11, rates(0.2)],
]);
const otherDeck: BuiltDeck = {
  deck: { deckId: '00000000-0000-4000-8000-000000000001' as DeckId, code: 'abc', name: 'Other deck' },
  copies: new Map([[1, 1]]),
};

const addsWith = (owned: [number, number][], builtDecks: BuiltDeck[] = [], mode: 'only' | 'first' = 'only') =>
  rankAdds({
    context: context(mode),
    poolIds: [1, 2, 3, 4, 10, 11],
    cards,
    rates: playRates,
    roles: new Map(),
    corpus,
    roleTargets: [],
    roleTags: new Map(),
    ownedBoost: 0,
    scoring: TEST_SCORING,
    availability: availability({ owned: new Map(owned), builtDecks }, twins),
    standIns: cards,
    limitPerCategory: 10,
  });

describe('rankAdds with a collection (T059)', () => {
  it("suggests only what the collection supplies in 'only' mode, and lists better unowned cards to buy", () => {
    const { groups, buyList } = addsWith([[2, 1]]);
    expect(groups.flatMap((g) => g.suggestions.map((s) => s.card.name))).toEqual(['Orzhov Signet']);
    // Sol Ring and Talisman beat the Signet by more than the margin, Thought Vessel doesn't. Nothing owned is a land, so
    // both lands gain their whole score at $1 and lead on value. Talisman has no price, so it comes last.
    expect(buyList?.map((s) => s.card.name)).toEqual(['Evolving Wilds', 'Terramorphic Expanse', 'Sol Ring', 'Talisman of Hierarchy']);
  });

  it('ranks the buy list by gain per dollar, cards without a price last', () => {
    const { buyList } = addsWith([[2, 1]]);
    const [wildsEntry, , ringEntry, talismanEntry] = buyList ?? [];
    // A land group with nothing owned compares against 0, so its whole score is the gain.
    expect(wildsEntry?.gain).toBeCloseTo(wildsEntry?.score.total ?? NaN, 3);
    expect(ringEntry?.valueScore).toBeCloseTo((ringEntry?.gain ?? 0) / 2, 3);
    expect(talismanEntry?.valueScore).toBeNull();
  });

  it("suggests a card held by a built deck, tagged with that deck", () => {
    const { groups, buyList } = addsWith([[1, 1]], [otherDeck]);
    const ring = groups.flatMap((g) => g.suggestions).find((s) => s.card.name === 'Sol Ring');
    expect(ring?.conflicts).toEqual([otherDeck.deck]);
    expect(buyList?.some((s) => s.card.name === 'Sol Ring')).toBe(false);
  });

  it('shows an owned twin standing in for the more played card, once', () => {
    const { groups } = addsWith([[11, 1]]);
    const lands = groups.find((g) => g.category === 'land')?.suggestions ?? [];
    expect(lands.map((s) => s.card.name)).toEqual(['Terramorphic Expanse']);
    expect(lands[0]?.owned).toEqual({ quantity: 1, standsInFor: { id: 10, name: 'Evolving Wilds' } });
    // Scored as Evolving Wilds, the name decks play.
    expect(lands[0]?.corpus?.inclusionRate).toBe(0.6);
  });

  it("keeps every card and no buy list in 'first' mode", () => {
    const { groups, buyList } = addsWith([[2, 1]], [], 'first');
    expect(groups.flatMap((g) => g.suggestions)).toHaveLength(6);
    expect(buyList).toBeUndefined();
  });
});

describe('rankCuts with a collection (T059)', () => {
  it('never calls a basic land or a card an owned twin covers unowned', () => {
    const result = rankCuts({
      context: context('only', [20, 10, 3]),
      cards,
      rates: new Map([[3, rates(0.01)]]),
      roles: new Map(),
      corpus,
      roleTargets: [],
      scoring: TEST_SCORING,
      availability: availability({ owned: new Map([[11, 1]]), builtDecks: [] }, twins),
      limit: 10,
    });
    const reasons = new Map(result.suggestions.map((s) => [s.card.name, s.reasons]));
    expect(reasons.get('Thought Vessel')).toContain('NOT_OWNED');
    expect(reasons.get('Plains') ?? []).not.toContain('NOT_OWNED');
    expect(reasons.get('Evolving Wilds') ?? []).not.toContain('NOT_OWNED');
  });
});

describe('rankSwaps with a collection (T059)', () => {
  const candidate = (c: RankCard, tagSimilarity: number) => ({
    cardId: c.summary.id as number,
    card: c,
    tagSimilarity,
    stapleScore: 0.5,
    functionalTwin: false,
    matchedTags: [],
    rates: playRates.get(c.summary.id) ?? null,
  });
  const target = card(30, 'Mind Stone', 'Artifact');
  // Sol Ring does the target's job far better than Thought Vessel; Orzhov Signet a little better.
  const similarity = new Map([
    [1, 0.9],
    [2, 0.45],
    [3, 0.4],
  ]);
  const pool = (candidates: RankCard[]): SwapPool => ({
    target,
    tagCount: 3,
    corpus,
    candidates: candidates.map((c) => candidate(c, similarity.get(c.summary.id) ?? 0.5)),
  });

  it("ranks the collection's replacements and lists better unowned ones to buy", () => {
    const result = rankSwaps(pool([vessel]), {
      context: context('only', [30]),
      limit: 5,
      ownedBoost: 0,
      scoring: TEST_SCORING,
      availability: availability({ owned: new Map([[3, 1]]), builtDecks: [] }, twins),
      buyPool: pool([ring, signet, vessel]),
    });
    expect(result.suggestions.map((s) => s.card.name)).toEqual(['Thought Vessel']);
    expect(result.suggestions[0]?.costDelta.basis).toBe('owned_replacement');
    expect(result.buyList?.map((s) => s.card.name)).toEqual(['Sol Ring']);
    expect(result.buyList?.[0]?.gain).toBeGreaterThanOrEqual(TEST_SCORING.collection.buyMargin);
  });

  it('says nothing owned fits when the collection supplies no replacement', () => {
    const result = rankSwaps(pool([]), {
      context: context('only', [30]),
      limit: 5,
      ownedBoost: 0,
      scoring: TEST_SCORING,
      availability: availability({ owned: new Map(), builtDecks: [] }, twins),
      buyPool: pool([ring]),
    });
    expect(result.emptyReason).toBe('NOTHING_OWNED_FITS');
    expect(result.buyList?.map((s) => s.card.name)).toEqual(['Sol Ring']);
  });
});
