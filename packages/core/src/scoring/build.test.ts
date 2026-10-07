import { describe, expect, it } from 'vitest';
import { availability } from '../collection/availability';
import type { CardId, CardSummary, IsoDateTime, OracleId, RecContext, TagId } from '../contract';
import { affinityTracker, deckAffinity, pmiIndex } from './affinity';
import { buildDeck, landTargets, manaSymbols, splitBasics, type BasicColour, type BuildInput } from './build';
import type { CardPlayRates, RankCard, RankCorpus } from './rank';
import { TEST_CORPUS_SETTINGS, TEST_SCORING } from './test-config';

const WU = 3;
const COMMANDER = 1000;
const RAMP = 'ramp-role';

function card(id: number, name: string, typeLine: string, opts: Partial<CardSummary> & { identity?: number } = {}): RankCard {
  const { identity = 1, ...rest } = opts;
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
    price: { usd: 1, finish: 'nonfoil', asOf: '2026-10-06T00:00:00Z' as IsoDateTime, source: 'scryfall' },
    ...rest,
  };
  return { summary, colorIdentity: identity, legal: true, isBasicLand: typeLine.startsWith('Basic') };
}

const rates = (inclusion: number): CardPlayRates => ({
  baseline: 0.05,
  baselineDeckCount: 5000,
  commanderDeckCount: 500,
  commanderRate: { inclusion, synergy: inclusion - 0.05 },
  hasExternalPrior: false,
  evidence: { scope: 'commander', decksWith: Math.round(inclusion * 500), commanderDeckCount: 500, inclusionRate: inclusion, synergy: inclusion - 0.05, limited: false },
});

const corpus: RankCorpus = {
  settings: TEST_CORPUS_SETTINGS,
  confidence: 'full',
  effectiveDeckCount: 500,
  roleProfile: { [RAMP]: 10 },
  curveProfile: {},
  prior: null,
  landCount: 36,
  basicLandCount: 20,
};

const rules = {
  massLandDenialTagIds: [],
  extraTurnTagIds: [],
  massLandDenialFromBracket: 4,
  maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 },
  extraTurnLoopResults: ['Infinite turns'],
  extraTurnLoopFromBracket: 4,
};

const commander = card(COMMANDER, 'Hanna', 'Legendary Creature — Human', { manaCost: '{1}{W}{U}', identity: WU, colorIdentity: 'WU' });
/** 80 spells, white and blue, scoring from high to low by id; every tenth is ramp. */
const spells = Array.from({ length: 80 }, (_, i) =>
  card(i + 1, `Spell ${String(i + 1).padStart(2, '0')}`, i % 2 === 0 ? 'Creature — Human' : 'Instant', {
    manaCost: i % 2 === 0 ? '{W}{W}' : '{U}',
    manaValue: (i % 6) + 1,
    identity: i % 2 === 0 ? 1 : 2,
  }),
);
const lands = Array.from({ length: 30 }, (_, i) => card(200 + i, `Land ${String(i + 1).padStart(2, '0')}`, 'Land', { manaCost: '', identity: WU }));
const plains = card(300, 'Plains', 'Basic Land — Plains', { manaCost: '' });
const island = card(301, 'Island', 'Basic Land — Island', { manaCost: '', identity: 2 });
const all = [commander, ...spells, ...lands, plains, island];
const cards = new Map(all.map((c) => [c.summary.id as number, c]));
const playRates = new Map<number, CardPlayRates>([
  ...spells.map((c, i) => [c.summary.id as number, rates(0.9 - i * 0.01)] as const),
  ...lands.map((c, i) => [c.summary.id as number, rates(0.8 - i * 0.02)] as const),
]);
const roles = new Map(spells.map((c, i) => [c.summary.id as number, i % 10 === 5 ? [RAMP] : []]));
const basics = new Map<BasicColour, RankCard>([
  ['W', plains],
  ['U', island],
]);
const roleTag = { id: RAMP as TagId, slug: 'ramp', label: 'Ramp' };

const context = (over: Partial<RecContext> = {}): RecContext => ({
  deck: { commanders: [COMMANDER as CardId], cards: [] },
  bracket: 3,
  bracketSource: 'user',
  includeGameChangers: true,
  ownership: null,
  ...over,
});

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  context: context(),
  poolIds: [...spells, ...lands].map((c) => c.summary.id as number),
  cards,
  rates: playRates,
  roles,
  corpus,
  roleTargets: [{ roleId: RAMP, label: 'Ramp', target: 10 }],
  roleTags: new Map([[RAMP, roleTag]]),
  scoring: TEST_SCORING,
  availability: null,
  bracketFacts: { rules, cards: { massLandDenial: new Set(), extraTurns: new Set() }, combos: [] },
  affinity: null,
  basics,
  ...over,
});

const deckIds = (result: ReturnType<typeof buildDeck>) => result.groups.flatMap((g) => g.cards.map((c) => c.card.id as number));
const basicCount = (result: ReturnType<typeof buildDeck>) => result.basics.reduce((n, b) => n + b.quantity, 0);

describe('manaSymbols and splitBasics', () => {
  it('counts coloured symbols, hybrid split between its colours', () => {
    expect(Object.fromEntries(manaSymbols('{2}{W}{W}'))).toEqual({ W: 2 });
    expect(Object.fromEntries(manaSymbols('{W/U}{G/P}{2/B}{C}{X}'))).toEqual({ W: 0.5, U: 0.5, G: 1, B: 1 });
    expect(Object.fromEntries(manaSymbols('{1}{R} // {1}{U}'))).toEqual({ R: 1, U: 1 });
  });

  it('splits basics by symbol share, none for a colour no spell asks for', () => {
    expect(Object.fromEntries(splitBasics(20, WU, new Map([['W', 3], ['U', 1]])))).toEqual({ W: 15, U: 5 });
    expect(Object.fromEntries(splitBasics(10, WU, new Map([['W', 4]])))).toEqual({ W: 10 });
    expect(Object.fromEntries(splitBasics(7, WU, new Map([['W', 1], ['U', 1]])))).toEqual({ W: 4, U: 3 });
  });

  it('splits evenly without symbols, and gives a colourless deck Wastes', () => {
    expect(Object.fromEntries(splitBasics(9, WU, new Map()))).toEqual({ W: 5, U: 4 });
    expect(Object.fromEntries(splitBasics(8, 0, new Map()))).toEqual({ C: 8 });
  });
});

describe('landTargets', () => {
  it("uses the commander's decks once they count, a typical count for its colours before", () => {
    expect(landTargets(corpus, WU, TEST_SCORING)).toEqual({ lands: 36, basics: 20 });
    expect(landTargets({ ...corpus, effectiveDeckCount: 0 }, WU, TEST_SCORING)).toEqual({ lands: 35, basics: 18 });
    expect(landTargets({ ...corpus, landCount: null, basicLandCount: null }, 31, TEST_SCORING)).toEqual({ lands: 36, basics: 11 });
  });
});

describe('affinityTracker', () => {
  it('gives every candidate the affinity deckAffinity gives against the deck so far', () => {
    const lifts = {
      own: pmiIndex([
        [1, 2, 3],
        [1, 3, 1.5],
        [2, 3, 0.5],
      ]),
      global: pmiIndex([
        [1, 4, 2],
        [3, 4, 4],
      ]),
    };
    const weights = new Map([
      [1, { rate: 0.2, keyDecks: 40 }],
      [2, { rate: 0.5, keyDecks: 100 }],
      [3, { rate: 0.05, keyDecks: 5 }],
      [4, { rate: 0.3, keyDecks: 0 }],
    ]);
    const tracker = affinityTracker(lifts, weights, TEST_SCORING.affinity);
    const deck: number[] = [];
    for (const next of [1, 3]) {
      tracker.add(next);
      deck.push(next);
      for (const candidate of [2, 4, 9]) expect(tracker.of(candidate)).toEqual(deckAffinity(candidate, deck, lifts, weights, TEST_SCORING.affinity));
    }
  });
});

describe('buildDeck', () => {
  it('fills every slot: the learned lands, the rest spells, deterministically', () => {
    const result = buildDeck(input());
    const ids = deckIds(result);
    const landIds = ids.filter((id) => id >= 200);
    expect(ids.length + basicCount(result)).toBe(99);
    expect(landIds.length + basicCount(result)).toBe(36);
    expect(landIds.length).toBe(16);
    expect(result.feasibility).toMatchObject({ slots: 99, filled: 99, filledByValue: 0, open: 0 });
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildDeck(input())).toEqual(result);
  });

  it('splits basics by the spells and the commander', () => {
    const result = buildDeck(input());
    const plainsCount = result.basics.find((b) => b.card.name === 'Plains')?.quantity ?? 0;
    const islandCount = result.basics.find((b) => b.card.name === 'Island')?.quantity ?? 0;
    expect(plainsCount + islandCount).toBe(20);
    expect(plainsCount).toBeGreaterThan(islandCount);
  });

  it('fills ramp first while the deck is short of it', () => {
    const result = buildDeck(input());
    const ids = deckIds(result);
    // 63 nonland slots: by play rate alone the build would stop at Spell 63, but Spell 66 fills a role it is short of.
    expect(ids).toContain(66);
    expect(ids.filter((id) => roles.get(id)?.includes(RAMP))).toHaveLength(7);
    expect(result.feasibility.roleShortfalls).toEqual([{ role: roleTag, short: 3 }]);
  });

  it('keeps the cards it is given and scores them against the rest', () => {
    const kept = spells[79]!.summary.id;
    const result = buildDeck(input({ context: context({ deck: { commanders: [COMMANDER as CardId], cards: [{ cardId: kept, quantity: 1, section: 'main' }] } }) }));
    const keptCard = result.groups.flatMap((g) => g.cards).find((c) => c.card.id === kept);
    expect(keptCard?.origin).toBe('kept');
    expect(deckIds(result).length + basicCount(result)).toBe(99);
  });

  it('never breaks a bracket rule: Game Changers, mass land denial, extra turns, combos above the bracket', () => {
    const gameChangers = [1, 3, 5, 7, 9];
    const gcCards = new Map(cards);
    for (const id of gameChangers) {
      const c = cards.get(id)!;
      gcCards.set(id, { ...c, summary: { ...c.summary, gameChanger: true } });
    }
    const facts = {
      rules,
      cards: { massLandDenial: new Set([2]), extraTurns: new Set([4, 6, 8]) },
      combos: [
        { variantId: 'c1', pieces: [10, 11], minBracket: 4, results: ['Win the game'], contextualResults: [], templateNames: [], missing: null },
        { variantId: 'c2', pieces: [12, 13], minBracket: 3, results: ['Win the game'], contextualResults: [], templateNames: [], missing: null },
      ],
    };
    const result = buildDeck(input({ cards: gcCards, bracketFacts: facts }));
    const ids = new Set(deckIds(result));
    expect(gameChangers.filter((id) => ids.has(id))).toHaveLength(3);
    expect(ids.has(2)).toBe(false);
    expect([4, 6, 8].filter((id) => ids.has(id))).toHaveLength(2);
    expect(ids.has(10) && ids.has(11)).toBe(false);
    expect(ids.has(12) && ids.has(13)).toBe(true);
    expect(result.estimatedBracket).toBeLessThanOrEqual(3);
    expect(result.bracketSignals.comboBracket).toBe(3);

    const bracket4 = buildDeck(input({ cards: gcCards, bracketFacts: facts, context: context({ bracket: 4 }) }));
    const ids4 = new Set(deckIds(bracket4));
    expect(gameChangers.every((id) => ids4.has(id)) && ids4.has(2) && ids4.has(10) && ids4.has(11)).toBe(true);
  });

  it('leaves out kept cards no deck under these commanders may hold', () => {
    const red = card(400, 'Red Card', 'Instant', { identity: 4, colorIdentity: 'R' });
    const banned = { ...card(401, 'Banned Card', 'Instant', { identity: WU }), legal: false };
    const keptCards = new Map([...cards, [400, red], [401, banned]]);
    const kept = context({ deck: { commanders: [COMMANDER as CardId], cards: [400, 401, 1].map((id) => ({ cardId: id as CardId, quantity: 1, section: 'main' as const })) } });
    const ids = deckIds(buildDeck(input({ cards: keptCards, context: kept })));
    expect(ids).toContain(1);
    expect(ids).not.toContain(400);
    expect(ids).not.toContain(401);
  });

  it('lists the combos the build is one card short of that the bracket allows', () => {
    const facts = {
      rules,
      cards: { massLandDenial: new Set<number>(), extraTurns: new Set<number>() },
      combos: [{ variantId: 'near', pieces: [1, 79], minBracket: 2, results: ['Win the game'], contextualResults: [], templateNames: [], missing: 79 }],
    };
    const result = buildDeck(input({ bracketFacts: facts }));
    expect(result.combos.map((c) => [c.id, c.card.id])).toEqual([['near', 79]]);
  });

  describe('from a collection', () => {
    const owned = new Map([...spells.slice(0, 30), ...lands.slice(0, 5)].map((c) => [c.summary.id as number, 1]));
    const available = availability({ owned, builtDecks: [] }, new Map());
    const collection = context({ ownership: { kind: 'account' }, ownershipMode: 'only' });
    const ownedPool = [...owned.keys()];
    const openPool = [...spells, ...lands].map((c) => c.summary.id as number);

    it('picks only owned cards and says what stays open', () => {
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool }));
      const ids = deckIds(result);
      expect(ids.every((id) => owned.has(id))).toBe(true);
      expect(ids.filter((id) => id < 200)).toHaveLength(30);
      expect(result.feasibility).toMatchObject({ slots: 99, filled: 30 + 5 + basicCount(result), filledByValue: 0, open: 33 });
      expect(basicCount(result)).toBe(31);
      expect(result.fillCost).toBeUndefined();
    });

    it('never shows one owned copy twice through a twin standing in', () => {
      // Lands 200 and 201 are twins and the player owns one copy of 200: it can fill one slot, for either card.
      const twinned = availability({ owned, builtDecks: [] }, new Map([[200, 200], [201, 200]]));
      const result = buildDeck(input({ context: collection, availability: twinned, standIns: cards, poolIds: [...ownedPool, 201] }));
      expect(deckIds(result).filter((id) => id === 200)).toHaveLength(1);
    });

    it('stops below the quality floor', () => {
      const scoring = { ...TEST_SCORING, build: { ...TEST_SCORING.build, qualityFloor: 1 } };
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool, scoring }));
      expect(deckIds(result).filter((id) => id < 200)).toHaveLength(0);
    });

    it('fills the open slots with unowned cards by value, with a running total', () => {
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool, fillIds: openPool, fill: 'value' }));
      const fills = result.groups.flatMap((g) => g.cards).filter((c) => c.origin === 'fill');
      expect(fills.length).toBe(result.feasibility.filledByValue);
      expect(fills.every((c) => !owned.has(c.card.id))).toBe(true);
      expect(result.fillCost).toEqual({ usd: fills.length, cards: fills.length, asOf: '2026-10-06T00:00:00Z' });
      expect(result.feasibility.open).toBe(99 - result.feasibility.filled - result.feasibility.filledByValue);
    });
  });
});
