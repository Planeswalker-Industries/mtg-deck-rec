// packages/core/src/journey/deck-tally.test.ts
import { describe, expect, it } from 'vitest';
import type { BracketSignals, CardId, ComboRef, DeckCombo, StatTargets } from '../contract';
import {
  buildTally,
  cardsShort,
  gradeDeck,
  shortOfTarget,
  statDeltas,
  syncTally,
  tallyCache,
  withinTolerance,
  type TallyCard,
  type TallyEntry,
} from './deck-tally';

const RAMP = 'ramp-role';
const DRAW = 'draw-role';

const targets: StatTargets = {
  source: 'commander',
  label: 'Liesa decks (102)',
  lands: 34,
  basicLands: 20,
  roles: [
    { roleId: RAMP, label: 'Ramp', target: 10 },
    { roleId: DRAW, label: 'Card advantage', target: 10 },
  ],
  curve: [0, 8, 12, 10, 8, 6, 3, 2],
  types: [],
  bracketLimits: { massLandDenialFromBracket: 4, maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 }, extraTurnLoopResults: ['Infinite turns'], extraTurnLoopFromBracket: 4 },
};

const noSignals: BracketSignals = { gameChangerCount: 0, massLandDenialIds: [], extraTurnIds: [], comboBracket: null, extraTurnLoop: false };

let nextId = 1;
const card = (over: Partial<TallyCard> = {}): TallyCard => ({
  id: nextId++ as CardId,
  typeLine: 'Creature — Elf',
  manaValue: 2,
  gameChanger: false,
  roles: [],
  ...over,
});
const forest = card({ typeLine: 'Basic Land — Forest', manaValue: 0 });
const bracket = (over = {}) => ({ chosen: 3 as const, signals: noSignals, combos: [] as DeckCombo[], overBracketAdds: new Map<CardId, ComboRef[]>(), ...over });

describe('shortOfTarget', () => {
  it('is short only outside the tolerance', () => {
    expect(shortOfTarget({ value: 23, target: 31 })).toBe(true); // 8 short, band 6.2
    expect(shortOfTarget({ value: 12, target: 14 })).toBe(false); // 2 short, band 2.8
    expect(shortOfTarget({ value: 9, target: 10 })).toBe(false); // 1 short, band 2
    expect(shortOfTarget({ value: 12, target: 10 })).toBe(false); // over is not short
  });
  it('counts whole cards against the rounded target', () => {
    expect(cardsShort({ value: 23, target: 30.6 })).toBe(8);
    expect(cardsShort({ value: 12, target: 10 })).toBe(0);
  });
});

describe('withinTolerance', () => {
  it('uses 20% of the target', () => {
    expect(withinTolerance(12, 10)).toBe(true);
    expect(withinTolerance(7.9, 10)).toBe(false);
    expect(withinTolerance(28, 34)).toBe(true); // 6 off, 20% of 34 is 6.8
  });
  it('never asks for less than one card', () => {
    expect(withinTolerance(0, 0.4)).toBe(true);
    expect(withinTolerance(1, 0.08)).toBe(true);
    expect(withinTolerance(2, 0.4)).toBe(false);
  });
});

describe('buildTally and applyCard', () => {
  it('counts lands, basics, curve, roles and Game Changers', () => {
    const ramp = card({ manaValue: 3, roles: [RAMP] });
    const gc = card({ manaValue: 1, gameChanger: true, typeLine: 'Artifact' });
    const t = buildTally([{ card: forest, quantity: 5 }, { card: ramp, quantity: 1 }, { card: gc, quantity: 1 }], [card({ gameChanger: true })]);
    expect(t.lands).toBe(5);
    expect(t.basicLands).toBe(5);
    expect(t.curve[3]).toBe(1);
    expect(t.curve[1]).toBe(1);
    expect(t.roles.get(RAMP)).toBe(1);
    expect(t.gameChangers).toBe(2); // the commander counts toward Game Changers
    expect(t.cards).toBe(7); // commanders are not in the main count
  });
  it('counts nonland cards by type, an artifact creature as a creature', () => {
    const t = buildTally(
      [
        { card: card({ typeLine: 'Artifact Creature — Golem' }), quantity: 1 },
        { card: card({ typeLine: 'Instant' }), quantity: 2 },
        { card: card({ typeLine: 'Battle — Siege' }), quantity: 1 },
        { card: forest, quantity: 3 },
      ],
      [card({ typeLine: 'Legendary Creature — Elf' })],
    );
    expect(t.types.get('creature')).toBe(1); // the commander isn't counted
    expect(t.types.get('instant')).toBe(2);
    expect(t.types.get('artifact')).toBeUndefined();
    expect([...t.types.values()].reduce((a, b) => a + b, 0)).toBe(3); // no land or battle
  });
  it('puts mana value 7 and up in the last bar', () => {
    const t = buildTally([{ card: card({ manaValue: 9 }), quantity: 1 }], []);
    expect(t.curve[7]).toBe(1);
  });
});

describe('syncTally', () => {
  it('applies only the cards that moved', () => {
    const a = card({ roles: [RAMP] });
    const b = card({ manaValue: 4 });
    const t = buildTally([{ card: a, quantity: 1 }, { card: forest, quantity: 3 }], []);
    syncTally(t, [{ card: forest, quantity: 2 }, { card: b, quantity: 1 }]);
    expect(t.roles.get(RAMP) ?? 0).toBe(0);
    expect(t.basicLands).toBe(2);
    expect(t.curve[4]).toBe(1);
    expect(t.main.has(a.id)).toBe(false);
  });

  it('always equals a full count of the deck it ends on', () => {
    // A small seeded generator, so a failure replays the same sequence.
    let seed = 42;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    const pool: TallyCard[] = Array.from({ length: 40 }, (_, i) =>
      card({
        manaValue: i % 9,
        typeLine: i % 5 === 0 ? 'Land' : i % 7 === 0 ? 'Basic Land — Island' : i % 2 === 0 ? 'Artifact Creature — Golem' : 'Instant',
        roles: i % 3 === 0 ? [RAMP] : i % 4 === 0 ? [RAMP, DRAW] : [],
        gameChanger: i % 11 === 0,
      }),
    );
    for (let run = 0; run < 200; run++) {
      const pick = () => pool[Math.floor(rand() * pool.length)]!;
      let deck = new Map<CardId, TallyEntry>();
      const t = buildTally([], []);
      for (let step = 0; step < 12; step++) {
        const next = new Map(deck);
        const c = pick();
        const q = (next.get(c.id)?.quantity ?? 0) + (rand() < 0.5 ? 1 : -1);
        if (q > 0) next.set(c.id, { card: c, quantity: q });
        else next.delete(c.id);
        deck = next;
        syncTally(t, [...deck.values()]);
      }
      const full = buildTally([...deck.values()], []);
      const nonzero = (m: Map<string, number>) => [...m.entries()].filter(([, n]) => n !== 0).sort();
      expect({ ...t, main: [...t.main.entries()].sort(), roles: nonzero(t.roles), types: nonzero(t.types) }).toEqual({
        ...full,
        main: [...full.main.entries()].sort(),
        roles: nonzero(full.roles),
        types: nonzero(full.types),
      });
    }
  });
});

describe('gradeDeck', () => {
  const deckOf = (lands: number, ramp: number) => [
    { card: forest, quantity: lands },
    ...Array.from({ length: ramp }, () => ({ card: card({ roles: [RAMP] }), quantity: 1 })),
  ];

  it('counts lands, basics, each role, the curve and the bracket, and is urgent under half', () => {
    // 20 basics: lands 20 of 34 (off), basics 20 of 20 (ok); ramp 2 of 10 (off); draw 0 of 10 (off);
    // curve: nothing at mana value 1 against 8 (off); bracket: nothing over 3 (ok). 2 of 6.
    const report = gradeDeck(buildTally(deckOf(20, 2), []), targets, bracket());
    expect(report.total).toBe(6);
    expect(report.okCount).toBe(2);
    expect(report.level).toBe('urgent');
  });

  it('is ok only when every stat is in line', () => {
    const manaValues = targets.curve.flatMap((n, mv) => Array.from({ length: n }, () => mv)); // 49 nonland cards
    const lineUp: TallyEntry[] = [
      { card: forest, quantity: 20 },
      { card: card({ typeLine: 'Land', manaValue: 0 }), quantity: 14 },
      ...manaValues.map((mv, i) => ({ card: card({ manaValue: mv, roles: i < 10 ? [RAMP] : i < 20 ? [DRAW] : [] }), quantity: 1 })),
    ];
    const report = gradeDeck(buildTally(lineUp, []), targets, bracket());
    expect(report.okCount).toBe(6);
    expect(report.level).toBe('ok');
  });

  it('is mild at exactly half', () => {
    // Lands 34 and basics 20 in line, bracket ok; ramp, draw and the curve off: 3 of 6.
    const t = buildTally([{ card: forest, quantity: 20 }, { card: card({ typeLine: 'Land' }), quantity: 14 }], []);
    const report = gradeDeck(t, targets, bracket());
    expect(report.okCount).toBe(3);
    expect(report.level).toBe('mild');
  });

  it('grades each card type when the targets have them', () => {
    const typed: StatTargets = {
      ...targets,
      types: [
        { cardType: 'creature', label: 'Creatures', target: 2 },
        { cardType: 'instant', label: 'Instants', target: 10 },
      ],
    };
    const t = buildTally([{ card: card(), quantity: 2 }, { card: card({ typeLine: 'Instant' }), quantity: 1 }], []);
    const report = gradeDeck(t, typed, bracket());
    expect(report.total).toBe(8);
    expect(report.stats.filter((s) => s.group === 'types').map((s) => [s.key, s.value, s.ok])).toEqual([
      ['creature', 2, true],
      ['instant', 1, false],
    ]);
  });

  it('fails the bracket for an intact combo above it and passes once a piece leaves', () => {
    const a = card();
    const b = card();
    const combo: DeckCombo = { id: 'x', url: 'https://commanderspellbook.com/combo/x/', results: ['Win the game'], minBracket: 4, pieceIds: [a.id, b.id], alsoNeeded: [] };
    const t = buildTally([{ card: a, quantity: 1 }, { card: b, quantity: 1 }], []);
    expect(gradeDeck(t, targets, bracket({ combos: [combo] })).bracket.ok).toBe(false);
    syncTally(t, [{ card: a, quantity: 1 }]);
    expect(gradeDeck(t, targets, bracket({ combos: [combo] })).bracket.ok).toBe(true);
  });

  it('fails the bracket while an added card completes a combo above it, until the bracket is raised to it', () => {
    const a = card();
    const t = buildTally([{ card: a, quantity: 1 }], []);
    const combo: ComboRef = { id: 'x', url: 'https://commanderspellbook.com/combo/x/', results: ['Win the game'], minBracket: 4 };
    const adds = new Map([[a.id, [combo]]]);
    expect(gradeDeck(t, targets, bracket({ overBracketAdds: adds })).bracket.ok).toBe(false);
    expect(gradeDeck(t, targets, bracket({ chosen: 4, overBracketAdds: adds })).bracket.ok).toBe(true);
  });

  it('keeps an added extra-turn loop over the bracket until the bracket that allows loops', () => {
    const a = card();
    const t = buildTally([{ card: a, quantity: 1 }], []);
    const loop: ComboRef = { id: 'y', url: 'https://commanderspellbook.com/combo/y/', results: ['Infinite turns'], minBracket: 2 };
    const adds = new Map([[a.id, [loop]]]);
    expect(gradeDeck(t, targets, bracket({ overBracketAdds: adds })).bracket.ok).toBe(false); // loops from bracket 4
    expect(gradeDeck(t, targets, bracket({ chosen: 4, overBracketAdds: adds })).bracket.ok).toBe(true);
  });

  it('counts Game Changers against the chosen bracket', () => {
    const t = buildTally(Array.from({ length: 4 }, () => ({ card: card({ gameChanger: true }), quantity: 1 })), []);
    expect(gradeDeck(t, targets, bracket()).bracket.ok).toBe(false); // bracket 3 allows 3
  });
});

describe('tallyCache', () => {
  const ramp = (report: ReturnType<ReturnType<typeof tallyCache>['report']>) => report.stats.find((s) => s.key === RAMP);

  it('builds once per base and keeps the round-start values', () => {
    const cache = tallyCache();
    const base = {};
    const a = card({ roles: [RAMP] });
    const start = [{ card: a, quantity: 1 }];
    const first = cache.report(base, start, [], targets, bracket(), start);
    const after = cache.report(base, [], [], targets, bracket(), start);
    expect(ramp(first)?.value).toBe(1);
    expect(ramp(after)?.value).toBe(0);
    expect(ramp(after)?.start).toBe(1);
  });

  it('keeps the round-start values when the base changes mid-round with the same start', () => {
    const cache = tallyCache();
    const a = card({ roles: [RAMP], manaValue: 3 });
    const start = [{ card: a, quantity: 1 }];
    cache.report({}, start, [], targets, bracket(), start);
    cache.report({}, [], [], targets, bracket(), start); // a new analysis of the same deck, after the card was cut
    const later = cache.report({}, [], [], targets, bracket(), start);
    expect(ramp(later)?.value).toBe(0);
    expect(ramp(later)?.start).toBe(1);
    expect(later.curve.bars[3]?.value).toBe(0);
    expect(later.curve.bars[3]?.start).toBe(1);
  });

  it('shows no ticks without a start, on a new base or after a change', () => {
    const cache = tallyCache();
    const base = {};
    const a = card({ roles: [RAMP] });
    cache.report({}, [{ card: a, quantity: 1 }], [], targets, bracket());
    const rebased = cache.report(base, [{ card: a, quantity: 1 }], [], targets, bracket());
    expect(ramp(rebased)?.start).toBe(ramp(rebased)?.value);
    const moved = cache.report(base, [], [], targets, bracket());
    expect(ramp(moved)?.value).toBe(0);
    expect(ramp(moved)?.start).toBe(0);
    expect(moved.curve.bars.every((b) => b.start === b.value)).toBe(true);
  });
});

describe('statDeltas', () => {
  const lines = ['lands', 'basicLands', 'ramp', 'removal', 'creature', 'artifact'].map((key) => ({ key, group: 'roles' as const }));
  const card = (typeLine: string, roles: string[]) => ({ id: 1 as CardId, typeLine, manaValue: 2, gameChanger: false, roles });
  const moves = (entries: [string, number][]) => new Map(entries.map(([key, delta]) => [key, { delta }]));

  it('counts what the incoming card adds and the outgoing one takes, leaving unmoved lines out', () => {
    const signet = card('Artifact', ['ramp']);
    const bolt = card('Instant', ['removal']);
    expect(statDeltas(lines, signet, bolt)).toEqual(moves([['ramp', 1], ['removal', -1], ['artifact', 1]]));
    expect(statDeltas(lines, signet, card('Artifact', ['ramp']))).toEqual(new Map());
  });

  it('counts lands and basic lands from the type line', () => {
    expect(statDeltas(lines, card('Basic Land — Plains', []), null)).toEqual(moves([['lands', 1], ['basicLands', 1]]));
    expect(statDeltas(lines, null, card('Land', ['ramp']))).toEqual(moves([['lands', -1], ['ramp', -1]]));
  });

  it('counts a card type once, as the first its front face has', () => {
    expect(statDeltas(lines, card('Artifact Creature — Golem', []), null)).toEqual(moves([['creature', 1]]));
  });
});

describe('mana base in the report', () => {
  const liesa = card({ typeLine: 'Legendary Creature — Angel', manaValue: 5, manaCost: '{2}{W}{W}{B}', colorIdentity: 'WB' });
  const land = (producedMana: string, typeLine: string) => card({ typeLine, manaValue: 0, producedMana });
  const deck = (): TallyEntry[] => [
    { card: land('W', 'Basic Land — Plains'), quantity: 25 },
    { card: land('B', 'Basic Land — Swamp'), quantity: 12 },
    { card: card({ typeLine: 'Sorcery', manaValue: 2, manaCost: '{B}{B}' }), quantity: 1 },
    { card: card(), quantity: 61 },
  ];

  it('adds a colour row per commander colour, counted in the level', () => {
    const report = gradeDeck(buildTally(deck(), [liesa]), targets, bracket());
    const colours = report.stats.filter((s) => s.group === 'colours');
    expect(colours.map((s) => s.key)).toEqual(['sources:W', 'sources:B']);
    expect(colours.find((s) => s.key === 'sources:B')).toMatchObject({ value: 12, target: 30, ok: false, label: 'Black sources' });
    expect(report.total).toBe(report.stats.length + 2);
    expect(report.mana.hardToCast.length).toBeGreaterThan(0);
    expect(report.mana.byTurn.map((b) => b.turn)).toEqual([3, 4, 6]);
  });

  it('adds no rows without commanders or coloured costs', () => {
    const plain = gradeDeck(buildTally([{ card: card(), quantity: 40 }], []), targets, bracket());
    expect(plain.stats.some((s) => s.group === 'colours')).toBe(false);
  });

  const signet = card({ typeLine: 'Artifact', manaValue: 2, producedMana: 'WB' });
  const swamp = land('B', 'Basic Land — Swamp');

  it('previews a Swamp as +1 black and a Signet as nothing while a 2-drop is the hardest to cast', () => {
    const report = gradeDeck(buildTally(deck(), [liesa]), targets, bracket());
    const preview = (add: TallyCard | null, remove: TallyCard | null = null) =>
      statDeltas(report.stats, add, remove, report.mana.deck).get('sources:B');
    expect(preview(swamp)).toEqual({ delta: 1 });
    // The binding black card is the {B}{B} sorcery (mana value 2): a Signet doesn't help it on curve.
    expect(preview(signet)).toBeUndefined();
  });

  it('previews a card that would become the hardest to cast with its target', () => {
    const report = gradeDeck(buildTally(deck(), [liesa]), targets, bracket());
    const triple = card({ typeLine: 'Sorcery', manaValue: 3, manaCost: '{B}{B}{B}' });
    const preview = statDeltas(report.stats, triple, null, report.mana.deck).get('sources:B');
    expect(preview?.target).toBeGreaterThan(30);
  });

  it('previews cutting the hardest card to cast: the next one sets the target and counts the rocks', () => {
    const late = card({ typeLine: 'Sorcery', manaValue: 4, manaCost: '{2}{B}{B}' });
    const base = deck();
    const bb = base[2]!.card;
    const entries = [...base, { card: late, quantity: 1 }, { card: signet, quantity: 4 }];
    const report = gradeDeck(buildTally(entries, [liesa]), targets, bracket());
    const preview = statDeltas(report.stats, null, bb, report.mana.deck).get('sources:B');
    // Four Signets count 0.75 each for the 4-drop, none for the 2-drop.
    expect(preview?.delta).toBe(3);
    expect(preview?.target).toBeLessThan(30);
  });

  it('measures the start tick against the requirement as it is now', () => {
    const late = card({ typeLine: 'Sorcery', manaValue: 4, manaCost: '{2}{B}{B}' });
    const base = deck();
    const bb = base[2]!.card;
    const start = [...base, { card: late, quantity: 1 }, { card: signet, quantity: 4 }];
    const now = start.filter((e) => e.card !== bb);
    const report = gradeDeck(buildTally(now, [liesa]), targets, bracket(), buildTally(start, [liesa]));
    const black = report.stats.find((s) => s.key === 'sources:B');
    // The {B}{B} sorcery left; no source did. Against the 4-drop, both decks have 12 Swamps and four Signets.
    expect(black?.start).toBe(black?.value);
  });
});
