import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, ComboRef, DeckCombo, OracleId, StatTargets } from '../contract';
import { applyCard, buildTally, gradeDeck, scoreWithMoves, toTallyCard, type BracketInput, type DeckTally, type TallyEntry } from './deck-tally';
import { addBreaksBand, comboPiecesToKeep, fixLines, MAX_FIX_MOVES, nextFixMove, planFixes, type FixCard, type FixInput, type FixMove } from './fix';

const RAMP = 'ramp-role';
const DRAW = 'draw-role';
const FOREST = 500;
/** Nonland cards per mana value in the test deck and its targets: 63 spells beside 36 lands. */
const CURVE = [0, 9, 14, 14, 10, 8, 5, 3];
const SPELLS = CURVE.reduce((a, b) => a + b, 0);

const targets: StatTargets = {
  source: 'commander',
  label: 'Test decks (500)',
  lands: 36,
  basicLands: 20,
  roles: [
    { roleId: RAMP, label: 'Ramp', target: 10 },
    { roleId: DRAW, label: 'Card advantage', target: 10 },
  ],
  curve: CURVE,
  types: [
    { cardType: 'creature', label: 'Creatures', target: 32 },
    { cardType: 'instant', label: 'Instants', target: 31 },
  ],
  colourSourceCap: null,
  bracketLimits: { massLandDenialFromBracket: 4, maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 }, extraTurnLoopResults: ['Infinite turns'], extraTurnLoopFromBracket: 4 },
};

const summary = (id: number, name: string, typeLine: string, over: Partial<CardSummary> = {}): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as OracleId,
  name,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  manaValue: 2,
  manaCost: '{1}{G}',
  typeLine,
  colorIdentity: 'G',
  images: null,
  gameChanger: false,
  released: true,
  keywords: [],
  price: null,
  ...over,
});

const fixCard = (card: CardSummary, score: number, roles: readonly string[] = []): FixCard => ({ card, roles, score, owned: null });
const land = (over: Partial<CardSummary> = {}) => ({ manaValue: 0, manaCost: '', producedMana: 'G', ...over });

const commander = toTallyCard(summary(1000, 'Commander', 'Legendary Creature — Elf', { manaCost: '{2}{G}', manaValue: 3 }), []);
const forest = fixCard(summary(FOREST, 'Forest', 'Basic Land — Forest', land()), 0.5);

interface DeckShape {
  ramp?: number;
  draw?: number;
  basics?: number;
  /** Per spell index: changes to the card. */
  spell?: (index: number) => Partial<CardSummary>;
}

/** A 99-card green deck on its targets: 36 lands (20 Forests), 63 spells on the curve, half creatures, 10 ramp and 10 draw. */
function deck({ ramp = 10, draw = 10, basics = 20, spell }: DeckShape = {}) {
  const manaValues = CURVE.flatMap((count, manaValue) => Array.from({ length: count }, () => manaValue));
  // Roles go to spells spread over the curve and both card types.
  const order = Array.from({ length: SPELLS }, (_, i) => (i * 17) % SPELLS);
  const roleOf = new Map<number, string[]>();
  order.slice(0, ramp).forEach((i) => roleOf.set(i, [RAMP]));
  order.slice(ramp, ramp + draw).forEach((i) => roleOf.set(i, [DRAW]));
  const spells = manaValues.map((manaValue, i) =>
    // Later spells fit better: the weakest fit is spell 1.
    fixCard(
      summary(i + 1, `Spell ${String(i + 1).padStart(2, '0')}`, i % 2 === 0 ? 'Creature — Elf' : 'Instant', { manaValue, ...spell?.(i) }),
      0.2 + i * 0.01,
      roleOf.get(i) ?? [],
    ),
  );
  const nonbasics = Array.from({ length: 36 - basics }, (_, i) => fixCard(summary(200 + i, `Land ${String(i + 1).padStart(2, '0')}`, 'Land', land()), 0.6 + i * 0.01));
  const cards = [...spells, ...nonbasics, forest];
  const entries: TallyEntry[] = cards.map((c) => ({ card: toTallyCard(c.card, c.roles), quantity: c.card.id === FOREST ? basics : 1 }));
  return { cards, entries, tally: buildTally(entries, [commander]) };
}

/** Cards to bring in: ten each of ramp creatures, draw instants and plain creatures, best first, and a Forest. */
const ins: FixCard[] = [
  ...Array.from({ length: 10 }, (_, i) => fixCard(summary(300 + i, `Ramp In ${i}`, 'Creature — Elf'), 0.9 - i * 0.01, [RAMP])),
  ...Array.from({ length: 10 }, (_, i) => fixCard(summary(320 + i, `Draw In ${i}`, 'Instant', { manaValue: 3 }), 0.8 - i * 0.01, [DRAW])),
  ...Array.from({ length: 10 }, (_, i) => fixCard(summary(340 + i, `Plain In ${i}`, 'Creature — Elf', { manaValue: 3 }), 0.7 - i * 0.01)),
  forest,
];

const bracket = (over: Partial<BracketInput> = {}): BracketInput => ({
  chosen: 3,
  signals: { gameChangerCount: 0, massLandDenialIds: [], extraTurnIds: [], comboBracket: null, extraTurnLoop: false },
  combos: [],
  overBracketAdds: new Map<CardId, ComboRef[]>(),
  ...over,
});

const input = (built: ReturnType<typeof deck>, over: Partial<FixInput> = {}): FixInput => ({
  tally: built.tally,
  targets,
  bracket: bracket(),
  pool: { ins, deck: built.cards },
  skipped: [],
  choices: {},
  addedIds: [],
  protectedIds: [],
  illegalIds: [],
  ...over,
});

const rolesOf = (given: FixInput, id: CardId) => [...given.pool.ins, ...given.pool.deck].find((c) => c.card.id === id)?.roles ?? [];

/** The deck with the moves applied, one at a time, checking that no move pushes a line out of its band. */
function applied(given: FixInput, moves: readonly FixMove[]): DeckTally {
  const tally = buildTally([...given.tally.main.values()], given.tally.commanders);
  const offLines = () => {
    const report = gradeDeck(tally, given.targets, given.bracket);
    return new Set([...report.stats.filter((s) => !s.ok).map((s) => s.key), ...report.curve.bars.filter((b) => !b.ok).map((b) => `curve:${b.manaValue}`)]);
  };
  for (const move of moves) {
    const before = offLines();
    applyCard(tally, toTallyCard(move.in, rolesOf(given, move.in.id)), 1);
    applyCard(tally, toTallyCard(move.out, rolesOf(given, move.out.id)), -1);
    for (const key of offLines()) expect(before.has(key), `${move.in.name} for ${move.out.name} broke ${key}`).toBe(true);
  }
  return tally;
}

const value = (tally: DeckTally, role: string) => tally.roles.get(role) ?? 0;

describe('nextFixMove and planFixes', () => {
  it('offers nothing for a deck already in line', () => {
    const given = input(deck());
    expect(gradeDeck(given.tally, targets, given.bracket).level).toBe('ok');
    expect(nextFixMove(given)).toBeNull();
    expect(planFixes(given)).toEqual([]);
    expect(fixLines(given)).toEqual([]);
  });

  it('brings a short role into its band with its best cards, taking out the weakest fits', () => {
    const given = input(deck({ ramp: 5 }));
    const moves = planFixes(given);
    // 5 of 10, band 8–12: three moves.
    expect(moves.map((m) => [m.line, m.in.name])).toEqual([
      [RAMP, 'Ramp In 0'],
      [RAMP, 'Ramp In 1'],
      [RAMP, 'Ramp In 2'],
    ]);
    // Spell 01, the weakest fit, is ramp itself: taking it out would help nothing.
    expect(moves[0]?.out.name).toBe('Spell 02');
    expect(moves.every((m) => !rolesOf(given, m.out.id).includes(RAMP))).toBe(true);
    const after = applied(given, moves);
    expect(value(after, RAMP)).toBe(8);
    expect(gradeDeck(after, targets, given.bracket).level).toBe('ok');
    expect(nextFixMove(given)).toEqual(moves[0]);
  });

  it('takes a role over its band down by its weakest cards, bringing in what a short line needs', () => {
    const given = input(deck({ ramp: 16, draw: 5 }));
    const moves = planFixes(given);
    const after = applied(given, moves);
    expect(value(after, RAMP)).toBe(12);
    expect(value(after, DRAW)).toBe(8);
    expect(gradeDeck(after, targets, given.bracket).level).toBe('ok');
    // The over-full role is taken first (roles in their configured order, largest gap first): out ramp, in draw.
    expect(moves[0]?.line).toBe(RAMP);
    expect(rolesOf(given, moves[0]!.out.id)).toEqual([RAMP]);
    expect(rolesOf(given, moves[0]!.in.id)).toEqual([DRAW]);
  });

  it('ends, and never breaks a band, on a deck that is far off', () => {
    const given = input(deck({ ramp: 0, draw: 22, basics: 30 }));
    const moves = planFixes(given);
    expect(moves.length).toBeLessThanOrEqual(MAX_FIX_MOVES);
    const after = applied(given, moves);
    expect(planFixes({ ...given, tally: after, addedIds: moves.map((m) => m.in.id) })).toEqual([]);
    // No card comes in twice or goes out after it came in.
    const broughtIn = moves.map((m) => m.in.id);
    expect(new Set(broughtIn).size).toBe(broughtIn.length);
    expect(moves.some((m) => broughtIn.includes(m.out.id))).toBe(false);
  });

  it('does not offer a skipped pair again, but either card may come back in another pair', () => {
    const given = input(deck({ ramp: 7 }));
    const first = nextFixMove(given)!;
    const skipped = [{ inId: first.in.id, outId: first.out.id }];
    const second = nextFixMove({ ...given, skipped })!;
    expect(second.in.id).toBe(first.in.id);
    expect(second.out.id).not.toBe(first.out.id);
    // With every in card for the line skipped against every out card, the line reads skipped.
    const all = given.pool.ins.flatMap((i) => given.pool.deck.map((o) => ({ inId: i.card.id, outId: o.card.id })));
    expect(nextFixMove({ ...given, skipped: all })).toBeNull();
    expect(fixLines({ ...given, skipped: all })).toEqual([{ line: RAMP, gap: 1, blocked: 'skipped' }]);
  });

  it('never takes out a kept combo piece or a card added this round', () => {
    const given = input(deck({ ramp: 7 }));
    const [weakest, next] = given.pool.deck.filter((c) => !c.roles.includes(RAMP)).map((c) => c.card.id) as [CardId, CardId];
    expect(nextFixMove(given)?.out.id).toBe(weakest);
    expect(nextFixMove({ ...given, protectedIds: [weakest] })?.out.id).toBe(next);
    expect(nextFixMove({ ...given, addedIds: [weakest] })?.out.id).toBe(next);
  });

  it('keeps the pieces of the combos the bracket allows, not of those over it', () => {
    const combo = (id: string, minBracket: 2 | 4, pieceIds: number[], alsoNeeded: string[] = []): DeckCombo => ({
      id,
      url: '',
      results: ['Win the game'],
      minBracket,
      pieceIds: pieceIds.map((p) => p as CardId),
      alsoNeeded,
    });
    const combos = [combo('fine', 2, [1, 2]), combo('over', 4, [3, 4]), combo('unchecked', 2, [5, 6], ['A Elf'])];
    expect(comboPiecesToKeep(bracket({ combos }), targets.bracketLimits)).toEqual([1, 2]);
  });

  it('counts nothing for an ignored line', () => {
    const given = input(deck({ ramp: 5 }), { choices: { [RAMP]: 'ignore' } });
    expect(planFixes(given)).toEqual([]);
    expect(fixLines(given)).toEqual([]);
    // A buy choice leaves the line counted: the pool decides what it may bring in.
    expect(planFixes({ ...given, choices: { [RAMP]: 'buy' } })).toHaveLength(3);
  });

  it('says why a line has no move: nothing to bring in, or nothing safe to take out', () => {
    const built = deck({ ramp: 5 });
    const noRamp = input(built, { pool: { ins: ins.filter((c) => !c.roles.includes(RAMP)), deck: built.cards } });
    expect(fixLines(noRamp)).toEqual([{ line: RAMP, gap: 3, blocked: 'noCardIn' }]);
    const allKept = input(built, { protectedIds: built.cards.map((c) => c.card.id) });
    expect(fixLines(allKept)).toEqual([{ line: RAMP, gap: 3, blocked: 'noCardOut' }]);
    expect(fixLines(input(built))).toEqual([{ line: RAMP, gap: 3, blocked: null }]);
  });

  it('takes a card that is not legal out first', () => {
    const built = deck({ ramp: 7 });
    const banned = built.cards[40]!.card;
    const move = nextFixMove(input(built, { illegalIds: [banned.id] }))!;
    expect(move.line).toBe('legal');
    expect(move.out.id).toBe(banned.id);
    // The in card is the best one for a short line.
    expect(move.in.name).toBe('Ramp In 0');
  });

  it('takes Game Changers over the bracket limit out on the bracket line', () => {
    // Four Game Changers in bracket 3, which allows three.
    const built = deck({ spell: (i) => (i >= 50 && i < 54 ? { gameChanger: true } : {}) });
    const given = input(built);
    expect(gradeDeck(given.tally, targets, given.bracket).bracket.ok).toBe(false);
    const moves = planFixes(given);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.line).toBe('bracket');
    expect(moves[0]?.out.name).toBe('Spell 51');
    expect(gradeDeck(applied(given, moves), targets, given.bracket).level).toBe('ok');
  });

  it('brings in a basic land for a colour short of sources', () => {
    // Twenty of the lands make no green: 16 sources, under what a {G}{G} spell on turn two asks for.
    const base = deck({ spell: (i) => (i === 20 ? { manaCost: '{G}{G}' } : {}) });
    const cards = base.cards.map((c) =>
      c.card.id === FOREST ? fixCard(summary(FOREST, 'Wastes', 'Basic Land — Wastes', land({ producedMana: 'C' })), c.score) : c,
    );
    const entries = cards.map((c) => ({ card: toTallyCard(c.card, c.roles), quantity: c.card.id === FOREST ? 20 : 1 }));
    const realForest = fixCard(summary(501, 'Forest', 'Basic Land — Forest', land()), 0.5);
    const given = input({ cards, entries, tally: buildTally(entries, [commander]) }, { pool: { ins: [...ins.slice(0, -1), realForest], deck: cards } });
    const short = gradeDeck(given.tally, targets, given.bracket).stats.find((s) => s.key === 'sources:G')!;
    expect(short.ok).toBe(false);
    const moves = planFixes(given);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.line === 'sources:G' && m.in.name === 'Forest')).toBe(true);
    const after = gradeDeck(applied(given, moves), targets, given.bracket).stats.find((s) => s.key === 'sources:G')!;
    expect(after.ok).toBe(true);
  });
});

describe('the Fix screens (T087)', () => {
  it('tries the focused line first, and the usual order after it', () => {
    const given = input(deck({ ramp: 5, draw: 5 }));
    expect(nextFixMove(given)?.line).toBe(RAMP);
    expect(nextFixMove({ ...given, focusLine: DRAW })?.line).toBe(DRAW);
    // A line that needs nothing changes nothing.
    expect(nextFixMove({ ...given, focusLine: 'lands' })?.line).toBe(RAMP);
    expect(planFixes({ ...given, focusLine: DRAW })[0]?.line).toBe(RAMP);
  });

  it('scores the deck with the selected moves made, leaving the tally as it was', () => {
    const given = input(deck({ ramp: 5 }));
    const moves = planFixes(given).map((m) => ({ in: toTallyCard(m.in, rolesOf(given, m.in.id)), out: toTallyCard(m.out, rolesOf(given, m.out.id)) }));
    const before = scoreWithMoves(given.tally, targets, given.bracket, {}, []);
    const after = scoreWithMoves(given.tally, targets, given.bracket, {}, moves);
    expect(before.okCount).toBe(before.total - 1);
    expect(after.okCount).toBe(after.total);
    // Two of the three moves leave ramp at 7, still under its band.
    expect(scoreWithMoves(given.tally, targets, given.bracket, {}, moves.slice(0, 2)).okCount).toBe(before.okCount);
    expect(value(given.tally, RAMP)).toBe(5);
    // A card on screen alone: one in, none out.
    expect(scoreWithMoves(given.tally, targets, given.bracket, { [RAMP]: 'ignore' }, [{ in: moves[0]!.in, out: null }]).total).toBe(before.total - 1);
  });

  it('says when one more copy of a card would leave a line above its band', () => {
    const { tally } = deck({ ramp: 12 });
    const ramp = toTallyCard(summary(900, 'More Ramp', 'Instant', { manaValue: 2 }), [RAMP]);
    const plain = toTallyCard(summary(901, 'Plain', 'Instant', { manaValue: 2 }), []);
    // Ramp is 12 of 10, the top of its band: a thirteenth is over it.
    expect(addBreaksBand(tally, targets, ramp)).toBe(true);
    expect(addBreaksBand(tally, targets, ramp, { [RAMP]: 'ignore' })).toBe(false);
    expect(addBreaksBand(tally, targets, plain)).toBe(false);
    // The mana value 7 bar holds 3 of 3 with a band of one card: a fifth is over it, a fourth is not.
    const seven = toTallyCard(summary(902, 'Big', 'Instant', { manaValue: 7 }), []);
    expect(addBreaksBand(tally, targets, seven)).toBe(false);
    applyCard(tally, seven, 1);
    expect(addBreaksBand(tally, targets, toTallyCard(summary(903, 'Bigger', 'Instant', { manaValue: 8 }), []))).toBe(true);
  });
});

describe('cards for lines opened to buying (T086)', () => {
  const bought = (id: number, score: number, buyFor: string[]): FixCard => ({
    ...fixCard(summary(id, `Bought ${id}`, 'Creature — Elf'), score, [RAMP]),
    buyFor,
  });

  it('brings in an unowned card only after every card the collection supplies', () => {
    // Ramp is 6 against 10: two short of the low edge of its band.
    const built = deck({ ramp: 6 });
    const pool = { ins: [ins[0]!, bought(400, 0.99, [RAMP]), bought(401, 0.98, [RAMP]), forest], deck: built.cards };
    const moves = planFixes(input(built, { pool }));
    expect(moves.map((m) => m.in.name)).toEqual(['Ramp In 0', 'Bought 400']);
    expect(moves.every((m) => m.line === RAMP)).toBe(true);
  });

  it('leaves an unowned card out of a line it was not opened for', () => {
    const built = deck({ ramp: 6 });
    const given = input(built, { pool: { ins: [bought(400, 0.99, [DRAW]), forest], deck: built.cards } });
    expect(planFixes(given)).toEqual([]);
    expect(fixLines(given)).toEqual([{ line: RAMP, gap: 2, blocked: 'noCardIn' }]);
  });
});
