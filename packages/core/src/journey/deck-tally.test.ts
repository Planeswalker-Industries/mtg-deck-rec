// packages/core/src/journey/deck-tally.test.ts
import { describe, expect, it } from 'vitest';
import type { BracketSignals, CardId, DeckCombo, StatTargets } from '../contract';
import { buildTally, gradeDeck, syncTally, tallyCache, withinTolerance, type TallyCard, type TallyEntry } from './deck-tally';

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
const bracket = (over = {}) => ({ chosen: 3 as const, signals: noSignals, combos: [] as DeckCombo[], overBracketIds: new Set<CardId>(), ...over });

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
        typeLine: i % 5 === 0 ? 'Land' : i % 7 === 0 ? 'Basic Land — Island' : 'Instant',
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
      expect({ ...t, main: [...t.main.entries()].sort(), roles: [...t.roles.entries()].filter(([, n]) => n !== 0).sort() }).toEqual({
        ...full,
        main: [...full.main.entries()].sort(),
        roles: [...full.roles.entries()].sort(),
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

  it('fails the bracket for an intact combo above it and passes once a piece leaves', () => {
    const a = card();
    const b = card();
    const combo: DeckCombo = { id: 'x', url: 'https://commanderspellbook.com/combo/x/', results: ['Win the game'], minBracket: 4, pieceIds: [a.id, b.id], alsoNeeded: [] };
    const t = buildTally([{ card: a, quantity: 1 }, { card: b, quantity: 1 }], []);
    expect(gradeDeck(t, targets, bracket({ combos: [combo] })).bracket.ok).toBe(false);
    syncTally(t, [{ card: a, quantity: 1 }]);
    expect(gradeDeck(t, targets, bracket({ combos: [combo] })).bracket.ok).toBe(true);
  });

  it('fails the bracket while an added card completes a combo above it', () => {
    const a = card();
    const t = buildTally([{ card: a, quantity: 1 }], []);
    expect(gradeDeck(t, targets, bracket({ overBracketIds: new Set([a.id]) })).bracket.ok).toBe(false);
  });

  it('counts Game Changers against the chosen bracket', () => {
    const t = buildTally(Array.from({ length: 4 }, () => ({ card: card({ gameChanger: true }), quantity: 1 })), []);
    expect(gradeDeck(t, targets, bracket()).bracket.ok).toBe(false); // bracket 3 allows 3
  });
});

describe('tallyCache', () => {
  it('builds once per base and keeps the round-start values', () => {
    const cache = tallyCache();
    const base = {};
    const a = card({ roles: [RAMP] });
    const first = cache.report(base, [{ card: a, quantity: 1 }], [], targets, bracket());
    const after = cache.report(base, [], [], targets, bracket());
    expect(first.stats.find((s) => s.key === RAMP)?.value).toBe(1);
    expect(after.stats.find((s) => s.key === RAMP)?.value).toBe(0);
    expect(after.stats.find((s) => s.key === RAMP)?.start).toBe(1);
  });
});
