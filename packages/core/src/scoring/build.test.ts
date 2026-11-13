import { describe, expect, it } from 'vitest';
import { availability } from '../collection/availability';
import type { CardId, CardSummary, IsoDateTime, OracleId, RecContext, StatTargets, TagId } from '../contract';
import { buildTally, gradeDeck, STAT_TOLERANCE_SHARE, toTallyCard } from '../journey/deck-tally';
import { planFixes, type FixCard } from '../journey/fix';
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
const plains = card(300, 'Plains', 'Basic Land — Plains', { manaCost: '', producedMana: 'W' });
const island = card(301, 'Island', 'Basic Land — Island', { manaCost: '', identity: 2, producedMana: 'U' });
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

/** Deck stats' targets with these card types (and this curve, by mana value). */
const statTargets = (types: Record<string, number>, curve: number[] = []): StatTargets => ({
  source: 'commander',
  label: 'Hanna decks (500)',
  lands: 36,
  basicLands: 20,
  roles: [{ roleId: RAMP, label: 'Ramp', target: 10 }],
  curve,
  types: Object.entries(types).map(([cardType, target]) => ({ cardType, label: cardType, target })),
  colourSourceCap: null,
  bracketLimits: { massLandDenialFromBracket: 4, maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 }, extraTurnLoopResults: [], extraTurnLoopFromBracket: 4 },
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
    expect(result.feasibility).toMatchObject({ slots: 99, filled: 99, filledByValue: 0, open: 0, collectionGaps: [] });
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildDeck(input())).toEqual(result);
  });

  it('breaks ties between equal scores on the wider staple, then the name (T083)', () => {
    // Every spell unplayed, so equal on play data: without staples the build takes them by name, with them by staple.
    const unplayed = new Map([...playRates].map(([id, r]) => [id, id <= spells.length ? rates(0) : r]));
    const widerLater = new Map(spells.map((c) => [c.summary.id as number, (c.summary.id as number) / 100]));
    const byName = deckIds(buildDeck(input({ rates: unplayed })));
    const byStapleIds = deckIds(buildDeck(input({ rates: unplayed, staples: widerLater })));
    expect(byName).toContain(2);
    expect(byName).not.toContain(80);
    expect(byStapleIds).toContain(80);
    expect(byStapleIds).not.toContain(2);
  });

  it('splits basics by the spells and the commander', () => {
    const result = buildDeck(input());
    const plainsCount = result.basics.find((b) => b.card.name === 'Plains')?.quantity ?? 0;
    const islandCount = result.basics.find((b) => b.card.name === 'Island')?.quantity ?? 0;
    expect(plainsCount + islandCount).toBe(20);
    expect(plainsCount).toBeGreaterThan(islandCount);
  });

  it('fills each role to its target before anything else, as far as the pool allows', () => {
    const result = buildDeck(input());
    const ids = deckIds(result);
    // Ramp's target is 10 and the pool holds 8: every one goes in, Spell 76 too, which play rate alone would leave out.
    expect(ids).toContain(76);
    expect(ids.filter((id) => roles.get(id)?.includes(RAMP))).toHaveLength(8);
  });

  it("keeps each card type inside Deck stats' band, and brings a short one up to it", () => {
    // Creatures are the even spells, which score higher: by play rate the build would run 32 creatures and 31 instants.
    const result = buildDeck(input({ statTargets: statTargets({ creature: 20, instant: 40 }) }));
    const types = deckIds(result).filter((id) => id < 200).map((id) => cards.get(id)!.summary.typeLine);
    const creatures = types.filter((t) => t.startsWith('Creature')).length;
    expect(creatures).toBeLessThanOrEqual(24);
    expect(types.length - creatures).toBeGreaterThanOrEqual(32);
  });

  it('keeps every curve bar inside its band when the pool allows', () => {
    // Spells cost 1 to 6, about eleven each; ask for few 1-drops and many 2-drops.
    const curve = [0, 2, 20, 11, 11, 11, 11, 0];
    const result = buildDeck(input({ statTargets: statTargets({}, curve) }));
    const ones = deckIds(result).filter((id) => id < 200 && cards.get(id)!.summary.manaValue === 1).length;
    expect(ones).toBeLessThanOrEqual(3);
  });

  it('picks lands that make a colour the deck is short of before better lands that make none', () => {
    // Land 30 is the worst by play rate but makes blue; the others make nothing.
    const blueLand = lands[29]!.summary.id as number;
    const fixing = new Map(cards);
    fixing.set(blueLand, card(blueLand, 'Land 30', 'Land', { manaCost: '', identity: WU, producedMana: 'U' }));
    const ids = deckIds(buildDeck(input({ cards: fixing })));
    expect(ids).toContain(blueLand);
  });

  it('gives each basic to the colour furthest under its source target', () => {
    // A blue 1-drop needing {U}{U}{U} sets a blue target far above white's; symbols alone would favour white.
    const hungry = card(150, 'Blue Hunger', 'Sorcery', { manaCost: '{U}{U}{U}', manaValue: 3, identity: 2 });
    const withHungry = new Map(cards).set(150, hungry);
    const result = buildDeck(input({ cards: withHungry, context: context({ deck: { commanders: [COMMANDER as CardId], cards: [{ cardId: 150 as CardId, quantity: 1, section: 'main' }] } }) }));
    const plainsCount = result.basics.find((b) => b.card.name === 'Plains')?.quantity ?? 0;
    const islandCount = result.basics.find((b) => b.card.name === 'Island')?.quantity ?? 0;
    expect(islandCount).toBeGreaterThan(plainsCount);
  });

  it('caps the colour source targets: past the cap, basics follow the mana symbols', () => {
    // With a cap of 1, one basic of each colour meets both targets; the rest split by symbols as before.
    const scoring = { ...TEST_SCORING, build: { ...TEST_SCORING.build, colourSourceCaps: [1, 1, 1, 1, 1, 1] } };
    const result = buildDeck(input({ scoring }));
    const symbols = new Map<string, number>();
    for (const id of [COMMANDER, ...deckIds(result).filter((id) => id < 200)]) {
      for (const [colour, n] of manaSymbols(cards.get(id)!.summary.manaCost ?? '')) symbols.set(colour, (symbols.get(colour) ?? 0) + n);
    }
    const rest = splitBasics(basicCount(result) - 2, WU, symbols);
    expect(Object.fromEntries(result.basics.map((b) => [b.card.name, b.quantity]))).toEqual({
      Plains: (rest.get('W') ?? 0) + 1,
      Island: (rest.get('U') ?? 0) + 1,
    });
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

  it('passes Deck stats on roles, card types and colours when every card is available', () => {
    // Half the lands make both colours, as a real pool's duals do; card types and the curve asked for as Deck stats would.
    const duals = new Map(cards);
    for (const l of lands.slice(0, 15)) duals.set(l.summary.id as number, card(l.summary.id as number, l.summary.name, 'Land', { manaCost: '', identity: WU, producedMana: 'WU' }));
    const targets = statTargets({ creature: 30, instant: 30 }, [0, 11, 11, 11, 10, 10, 10, 0]);
    const result = buildDeck(input({ cards: duals, statTargets: targets }));
    const main = [
      ...deckIds(result).map((id) => ({ card: toTallyCard(duals.get(id)!.summary, roles.get(id) ?? []), quantity: 1 })),
      ...result.basics.map((b) => ({ card: toTallyCard(b.card, []), quantity: b.quantity })),
    ];
    const report = gradeDeck(buildTally(main, [toTallyCard(commander.summary, [])]), targets, {
      chosen: 3,
      signals: { gameChangerCount: 0, massLandDenialIds: [], extraTurnIds: [], comboBracket: null, extraTurnLoop: false },
      combos: [],
      overBracketAdds: new Map(),
    });
    const off = report.stats.filter((line) => line.group !== 'mana' && !line.ok).map((line) => `${line.key} ${line.value}/${line.target}`);
    expect(off).toEqual([]);
  });

  it('leaves Fix nothing to do: a fresh build is in line on every line Fix counts', () => {
    const duals = new Map(cards);
    for (const l of lands.slice(0, 15)) duals.set(l.summary.id as number, card(l.summary.id as number, l.summary.name, 'Land', { manaCost: '', identity: WU, producedMana: 'WU' }));
    const targets = statTargets({ creature: 30, instant: 30 }, [0, 11, 11, 11, 10, 10, 10, 0]);
    const result = buildDeck(input({ cards: duals, statTargets: targets }));
    const picked = result.groups.flatMap((g) => g.cards);
    const fixCard = (summary: CardSummary, score: number): FixCard => ({ card: summary, roles: roles.get(summary.id) ?? [], score, owned: null });
    const deck = [...picked.map((c) => fixCard(c.card, c.score.total)), ...result.basics.map((b) => fixCard(b.card, 0))];
    const inDeck = new Set(deck.map((c) => c.card.id as number));
    const main = [
      ...picked.map((c) => ({ card: toTallyCard(c.card, roles.get(c.card.id) ?? []), quantity: 1 })),
      ...result.basics.map((b) => ({ card: toTallyCard(b.card, []), quantity: b.quantity })),
    ];
    // Every card the build passed over may come in, and so may the basic lands.
    const ins = [
      ...[...spells, ...lands].filter((c) => !inDeck.has(c.summary.id)).map((c) => fixCard(duals.get(c.summary.id)!.summary, playRates.get(c.summary.id)?.commanderRate?.inclusion ?? 0)),
      ...[plains, island].map((c) => fixCard(c.summary, 0)),
    ];
    const moves = planFixes({
      tally: buildTally(main, [toTallyCard(commander.summary, [])]),
      targets,
      bracket: { chosen: 3, signals: result.bracketSignals, combos: [], overBracketAdds: new Map() },
      pool: { ins, deck },
      skipped: [],
      choices: {},
      addedIds: [],
      protectedIds: [],
      illegalIds: [],
    });
    expect(moves.map((m) => `${m.line}: ${m.in.name} for ${m.out.name}`)).toEqual([]);
  });

  it('counts a land that draws cards toward the role: the role stays inside its band', () => {
    // Every land cycles and a fifth of the spells draw: by play rate the lands alone would put 16 more in the role.
    const DRAW = 'draw-role';
    const drawSpells = spells.filter((_, i) => i % 5 === 1).map((c) => c.summary.id as number);
    const landIds = lands.map((c) => c.summary.id as number);
    const withDraw = new Map<number, readonly string[]>([...roles, ...[...drawSpells, ...landIds].map((id): [number, string[]] => [id, [DRAW]])]);
    const target = 7;
    const result = buildDeck(input({ roles: withDraw, roleTargets: [{ roleId: RAMP, label: 'Ramp', target: 10 }, { roleId: DRAW, label: 'Draw', target }] }));
    const drawing = deckIds(result).filter((id) => withDraw.get(id)?.includes(DRAW)).length;
    expect(drawing).toBeLessThanOrEqual(target * (1 + STAT_TOLERANCE_SHARE));
  });

  describe('from a collection', () => {
    const owned = new Map([...spells.slice(0, 30), ...lands.slice(0, 5)].map((c) => [c.summary.id as number, 1]));
    const available = availability({ owned, builtDecks: [] }, new Map());
    const collection = context({ ownership: { kind: 'account' }, ownershipMode: 'only' });
    const ownedPool = [...owned.keys()];
    const openPool = [...spells, ...lands].map((c) => c.summary.id as number);

    it('picks only owned cards and says what stays open', () => {
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool }));
      // The 30 owned spells hold three ramp cards against a target of 10.
      expect(result.feasibility.collectionGaps).toContain(RAMP);
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

    it('fills spell slots past the quality floor, but leaves weak nonbasic lands to basics while basics stay in their band', () => {
      const scoring = { ...TEST_SCORING, build: { ...TEST_SCORING.build, qualityFloor: 1 } };
      // These decks run 34 basics: 36 of them is inside the band.
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool, scoring, corpus: { ...corpus, basicLandCount: 34 } }));
      const ids = deckIds(result);
      expect(ids.filter((id) => id < 200)).toHaveLength(30);
      expect(ids.filter((id) => id >= 200)).toHaveLength(0);
      expect(basicCount(result)).toBe(result.landTarget);
      expect(result.feasibility.collectionGaps).not.toContain('basicLands');
    });

    it('takes owned lands under the floor rather than push basics over their band, as Fix would', () => {
      const scoring = { ...TEST_SCORING, build: { ...TEST_SCORING.build, qualityFloor: 1 } };
      // 20 basics is the target and 24 the top of the band: every owned land goes in, and five are not enough.
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool, scoring }));
      expect(deckIds(result).filter((id) => id >= 200)).toHaveLength(5);
      expect(basicCount(result)).toBe(31);
      expect(result.feasibility.collectionGaps).toContain('basicLands');
    });

    it('takes an owned land under the floor that makes a colour basics leave short', () => {
      const scoring = { ...TEST_SCORING, build: { ...TEST_SCORING.build, qualityFloor: 1, colourSourceCaps: [null, null, 25] } };
      // 34 basics are fine by their band, but 36 land slots can't give white and blue 25 sources each without duals.
      const duals = lands.slice(0, 5).map((c) => ({ ...c, summary: { ...c.summary, producedMana: 'WU' } }));
      const withDuals = new Map([...cards, ...duals.map((c) => [c.summary.id as number, c] as const)]);
      const result = buildDeck(
        input({ context: collection, availability: available, poolIds: ownedPool, scoring, cards: withDuals, corpus: { ...corpus, basicLandCount: 34 } }),
      );
      expect(deckIds(result).filter((id) => id >= 200).length).toBeGreaterThan(0);
    });

    it('buys for a line the player opened once the owned cards run out, best first', () => {
      const buying = context({ ownership: { kind: 'account' }, ownershipMode: 'only', buyFor: [RAMP] });
      const result = buildDeck(input({ context: buying, availability: available, poolIds: ownedPool, fillIds: openPool }));
      const bought = result.groups.flatMap((g) => g.cards).filter((c) => c.origin === 'fill');
      // Three of the eight ramp spells are owned; the other five are bought, and nothing else is.
      expect(bought.map((c) => c.card.id as number).sort((a, b) => a - b)).toEqual([36, 46, 56, 66, 76]);
      expect(bought.every((c) => c.owned === null)).toBe(true);
      expect(result.feasibility.collectionGaps).not.toContain(RAMP);
      expect(result.feasibility.filledByValue).toBe(5);
      expect(result.fillCost).toEqual({ usd: 5, cards: 5, asOf: '2026-10-06T00:00:00Z' });
    });

    it('buys nothing for a line the collection fills, or without the open pool', () => {
      const buying = context({ ownership: { kind: 'account' }, ownershipMode: 'only', buyFor: [RAMP] });
      const filled = buildDeck(input({ context: buying, availability: available, poolIds: ownedPool, fillIds: openPool, corpus: { ...corpus, roleProfile: { [RAMP]: 3 } } }));
      expect(filled.feasibility.filledByValue).toBe(0);
      expect(buildDeck(input({ context: buying, availability: available, poolIds: ownedPool })).feasibility.filledByValue).toBe(0);
    });

    it('does not call a line over its band a gap: more cards would not help', () => {
      // A target of one ramp card; the collection's spells all go in, three ramp cards among them.
      const result = buildDeck(input({ context: collection, availability: available, poolIds: ownedPool, corpus: { ...corpus, roleProfile: { [RAMP]: 1 } } }));
      expect(deckIds(result).filter((id) => (roles.get(id) ?? []).includes(RAMP))).toHaveLength(3);
      expect(result.feasibility.collectionGaps).not.toContain(RAMP);
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
