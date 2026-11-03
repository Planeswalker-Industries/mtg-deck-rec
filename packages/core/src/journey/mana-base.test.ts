// packages/core/src/journey/mana-base.test.ts
import { describe, expect, it } from 'vitest';
import type { CardId } from '../contract';
import {
  castingHalves,
  consistencyTarget,
  landsByTurnChance,
  manaBase,
  onCurveChance,
  sourceCredit,
  sourcesNeeded,
  type ManaCard,
  type ManaEntry,
} from './mana-base';

let nextId = 1;
const card = (over: Partial<ManaCard> = {}): ManaCard => ({ id: nextId++ as CardId, typeLine: 'Instant', manaValue: 2, ...over });
const many = (n: number, over: Partial<ManaCard>): ManaEntry => ({ card: card(over), quantity: n });

describe('castingHalves', () => {
  it('reads coloured pips and keeps the card mana value', () => {
    expect(castingHalves({ manaCost: '{2}{B}{B}', manaValue: 4 })).toEqual([{ needs: [{ colours: 'B', pips: 2 }], manaValue: 4 }]);
  });
  it('groups a hybrid pip under its pair, in WUBRGC order', () => {
    expect(castingHalves({ manaCost: '{B/W}{B/W}', manaValue: 2 })).toEqual([{ needs: [{ colours: 'WB', pips: 2 }], manaValue: 2 }]);
  });
  it('needs no colour for Phyrexian or {2/W} pips, and counts {C}', () => {
    expect(castingHalves({ manaCost: '{1}{B/P}{W/U/P}{2/W}', manaValue: 5 })).toEqual([]);
    expect(castingHalves({ manaCost: '{4}{C}', manaValue: 5 })).toEqual([{ needs: [{ colours: 'C', pips: 1 }], manaValue: 5 }]);
  });
  it('counts X as 0 and returns nothing for no cost', () => {
    expect(castingHalves({ manaCost: '{X}{B}{B}', manaValue: 2 })).toEqual([{ needs: [{ colours: 'B', pips: 2 }], manaValue: 2 }]);
    expect(castingHalves({ manaCost: '', manaValue: 0 })).toEqual([]);
    expect(castingHalves({ manaValue: 0 })).toEqual([]);
  });
  it('splits a split card into halves with their own mana values', () => {
    expect(castingHalves({ manaCost: '{1}{R} // {1}{U}', manaValue: 4 })).toEqual([
      { needs: [{ colours: 'R', pips: 1 }], manaValue: 2 },
      { needs: [{ colours: 'U', pips: 1 }], manaValue: 2 },
    ]);
  });
});

describe('sourceCredit', () => {
  const plains = card({ typeLine: 'Basic Land — Plains', producedMana: 'W', manaValue: 0 });
  const tower = card({ typeLine: 'Land', producedMana: 'WUBRG', manaValue: 0 });
  const delta = card({ typeLine: 'Land', findsMana: 'UB', manaValue: 0 });
  const wilds = card({ typeLine: 'Land', findsMana: 'WUBRGC', findsBasicOnly: true, manaValue: 0 });
  const mdfc = card({ typeLine: 'Sorcery // Land', producedMana: 'U', manaValue: 7 });
  const birds = card({ typeLine: 'Creature — Bird', producedMana: 'WUBRG', manaValue: 1 });
  const signet = card({ typeLine: 'Artifact', producedMana: 'WB', manaValue: 2 });
  const sphere = card({ typeLine: 'Artifact', producedMana: 'WUBRG', manaValue: 3 });
  const growth = card({ typeLine: 'Sorcery', findsMana: 'WUBRGC', findsBasicOnly: true, manaValue: 2 });
  const cultivate = card({ typeLine: 'Sorcery', findsMana: 'WUBRGC', findsBasicOnly: true, manaValue: 3 });
  const ritual = card({ typeLine: 'Instant', producedMana: 'B', manaValue: 1 });

  it('counts lands, fetches and any-colour lands in the deck colours fully', () => {
    expect(sourceCredit(plains, 'W', 1, 'WB')).toBe(1);
    expect(sourceCredit(plains, 'B', 1, 'WB')).toBe(0);
    expect(sourceCredit(tower, 'B', 1, 'WB')).toBe(1);
    expect(sourceCredit(tower, 'U', 1, 'WB')).toBe(0);
    expect(sourceCredit(delta, 'B', 1, 'UB')).toBe(1);
  });
  it('gives a basic-only fetch two thirds from three deck colours', () => {
    expect(sourceCredit(wilds, 'W', 1, 'WB')).toBe(1);
    expect(sourceCredit(wilds, 'W', 1, 'WBG')).toBeCloseTo(2 / 3);
  });
  it('gives an MDFC land side 0.8 and a hybrid need a source of either colour', () => {
    expect(sourceCredit(mdfc, 'U', 1, 'U')).toBe(0.8);
    expect(sourceCredit(plains, 'WB', 2, 'WB')).toBe(1);
  });
  it('times dorks, rocks and ramp by the spell they help', () => {
    expect(sourceCredit(birds, 'B', 1, 'WB')).toBe(0);
    expect(sourceCredit(birds, 'B', 2, 'WB')).toBe(0.5);
    expect(sourceCredit(signet, 'W', 2, 'WB')).toBe(0);
    expect(sourceCredit(signet, 'W', 3, 'WB')).toBe(0.75);
    expect(sourceCredit(sphere, 'W', 4, 'WB')).toBe(0);
    expect(sourceCredit(sphere, 'W', 5, 'WB')).toBe(0.5);
    expect(sourceCredit(growth, 'B', 3, 'WB')).toBe(0.75);
    expect(sourceCredit(cultivate, 'B', 4, 'WB')).toBe(0);
    expect(sourceCredit(cultivate, 'B', 5, 'WB')).toBe(0.5);
  });
  it('counts a land search toward {C} only when the deck has such a land to find', () => {
    expect(sourceCredit(wilds, 'C', 1, 'WB')).toBe(0);
    expect(sourceCredit(wilds, 'C', 1, 'WB', { any: true, basic: false })).toBe(0);
    expect(sourceCredit(wilds, 'C', 1, 'WB', { any: true, basic: true })).toBe(1);
    const anyLand = card({ typeLine: 'Sorcery', findsMana: 'WUBRGC', manaValue: 2 });
    expect(sourceCredit(anyLand, 'C', 3, 'WB', { any: true, basic: false })).toBe(0.75);
  });
  it('gives rituals and cards that make nothing 0', () => {
    expect(sourceCredit(ritual, 'B', 4, 'B')).toBe(0);
    expect(sourceCredit(card(), 'B', 4, 'B')).toBe(0);
  });
});

describe('sourcesNeeded and consistencyTarget', () => {
  it('reads the table, clamps outside it and adds one for gold', () => {
    expect(sourcesNeeded(2, 2, false)).toBe(30);
    expect(sourcesNeeded(2, 4, true)).toBe(27);
    expect(sourcesNeeded(1, 9, false)).toBe(14);
    expect(sourcesNeeded(4, 4, false)).toBe(36);
    expect(sourcesNeeded(5, 6, false)).toBe(36);
  });
  it('asks 89 + M percent, M from 1 to 7', () => {
    expect(consistencyTarget(0)).toBeCloseTo(0.9);
    expect(consistencyTarget(4)).toBeCloseTo(0.93);
    expect(consistencyTarget(12)).toBeCloseTo(0.96);
  });
});

describe('onCurveChance', () => {
  it('matches a brute-force count of every shuffle of a 10-card deck', () => {
    // 2 sources, 3 other lands, 5 spells; checked against all 2,520 distinct orders.
    expect(onCurveChance(10, 5, 2, 1, 1)).toBeCloseTo(0.977777777, 6);
    expect(onCurveChance(10, 5, 2, 2, 2)).toBeCloseTo(0.8, 6);
  });
  it.each([
    [19, 1, 1],
    [30, 2, 2],
    [26, 4, 2],
    [36, 3, 3],
    [14, 6, 1],
  ])('lands near Karsten’s target with his %i sources (turn %i, %i pips)', (sources, turn, pips) => {
    expect(Math.abs(onCurveChance(99, 41, sources, turn, pips) - consistencyTarget(turn))).toBeLessThan(0.03);
  });
  it('rises with sources and stays a probability in a tiny deck', () => {
    const chances = [10, 15, 20, 25, 30].map((s) => onCurveChance(99, 37, s, 3, 2));
    expect([...chances].sort((a, b) => a - b)).toEqual(chances);
    for (const chance of [onCurveChance(9, 4, 2, 3, 1), onCurveChance(0, 0, 0, 3, 1), onCurveChance(9, 9, 9, 6, 2)]) {
      expect(chance).toBeGreaterThanOrEqual(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });
});

describe('landsByTurnChance', () => {
  it('falls with the turn and is 0 for an empty deck', () => {
    const [three, four, six] = [3, 4, 6].map((t) => landsByTurnChance(99, 37, t));
    expect(three).toBeCloseTo(0.9161, 3);
    expect(four).toBeCloseTo(0.7621, 3);
    expect(six).toBeCloseTo(0.4052, 3);
    expect(landsByTurnChance(0, 0, 3)).toBe(0);
  });
});

describe('manaBase', () => {
  const swamp = { typeLine: 'Basic Land — Swamp', producedMana: 'B', manaValue: 0 };
  const plains = { typeLine: 'Basic Land — Plains', producedMana: 'W', manaValue: 0 };

  it('finds the binding card per colour and lists cards under target worst first', () => {
    const damn = card({ manaCost: '{B}{B}', manaValue: 2, typeLine: 'Sorcery' });
    const avacyn = card({ manaCost: '{3}{W}{W}{W}', manaValue: 6, typeLine: 'Legendary Creature — Angel' });
    const main = [many(25, plains), many(12, swamp), { card: damn, quantity: 1 }, { card: avacyn, quantity: 1 }, many(60, {})];
    const liesa = card({ manaCost: '{2}{W}{W}{B}', manaValue: 5, typeLine: 'Legendary Creature — Angel' });
    const report = manaBase(main, [liesa], 'WB');

    const black = report.colours.find((c) => c.colour === 'B')!;
    expect(black.cardId).toBe(damn.id);
    expect(black.needed).toBe(30);
    expect(black.sources).toBe(12);
    expect(report.colours.map((c) => c.colour)).toEqual(['W', 'B']);
    expect(report.hardToCast[0]!.cardId).toBe(damn.id);
    expect(report.hardToCast.map((h) => h.chance)).toEqual([...report.hardToCast.map((h) => h.chance)].sort((a, b) => a - b));
    expect(report.hardToCast.find((h) => h.cardId === liesa.id)?.commander).toBe(true);
    expect(report.byTurn.map((b) => b.turn)).toEqual([3, 4, 6]);
  });

  it('adds one source for a gold card and uses a split card’s easier half', () => {
    const gold = card({ manaCost: '{2}{W}{B}', manaValue: 4 });
    // With one Swamp, {1}{W} is the easier half: the {B}{B}{B} half (36 sources) must not set the black row.
    const split = card({ manaCost: '{B}{B}{B} // {1}{W}', manaValue: 5 });
    const report = manaBase([many(36, plains), many(1, swamp), { card: gold, quantity: 1 }, { card: split, quantity: 1 }, many(61, {})], [], 'WB');
    expect(report.colours.find((c) => c.colour === 'B')).toMatchObject({ cardId: gold.id, needed: sourcesNeeded(1, 4, true) });
  });

  it('adds nothing for gold when a hybrid pip is paid by the card’s own colour', () => {
    const mono = card({ manaCost: '{1}{W}{W/B}', manaValue: 3 });
    const report = manaBase([many(37, plains), { card: mono, quantity: 1 }, many(61, {})], [], 'WB');
    expect(report.colours.find((c) => c.colour === 'W')).toMatchObject({ cardId: mono.id, needed: sourcesNeeded(1, 3, false) });
  });

  it('sets no requirement from the spell face of a spell/land card', () => {
    const restoration = card({ manaCost: '{4}{U}{U}{U}', manaValue: 7, typeLine: 'Sorcery // Land', producedMana: 'U' });
    const report = manaBase([many(36, { typeLine: 'Basic Land — Island', producedMana: 'U', manaValue: 0 }), { card: restoration, quantity: 1 }, many(62, {})], [], 'U');
    expect(report.colours).toEqual([]);
    expect(report.hardToCast).toEqual([]);
  });

  it('counts a card that transforms into a land as a spell, not a source', () => {
    const azcanta = card({ manaCost: '{1}{U}', manaValue: 2, typeLine: 'Legendary Enchantment // Legendary Land', producedMana: 'U', layout: 'transform' });
    const mdfc = card({ manaCost: '{4}{U}{U}{U}', manaValue: 7, typeLine: 'Sorcery // Land', producedMana: 'U', layout: 'modal_dfc' });
    expect(sourceCredit(azcanta, 'U', 4, 'U')).toBe(0);
    expect(sourceCredit(mdfc, 'U', 4, 'U')).toBe(0.8);
    const report = manaBase([many(30, { typeLine: 'Basic Land — Island', producedMana: 'U', manaValue: 0 }), { card: azcanta, quantity: 1 }, many(68, {})], [], 'U');
    expect(report.colours).toMatchObject([{ colour: 'U', cardId: azcanta.id, sources: 30 }]);
  });

  it('leaves out cards that need a colour outside the deck’s', () => {
    const bolt = card({ manaCost: '{R}', manaValue: 1 });
    const kitchenFinks = card({ manaCost: '{1}{G/W}{G/W}', manaValue: 3 });
    const report = manaBase([many(37, plains), { card: bolt, quantity: 1 }, { card: kitchenFinks, quantity: 1 }, many(60, {})], [], 'WB');
    expect(report.colours.map((c) => c.colour)).toEqual([]);
    expect(report.hardToCast.some((h) => h.cardId === bolt.id)).toBe(false);
    // A hybrid pip one deck colour can pay stays in: 37 Plains pay it.
    expect(report.hardToCast.some((h) => h.cardId === kitchenFinks.id)).toBe(false);
  });

  it('has no colour rows for a deck with no commander colours and no {C} costs', () => {
    const report = manaBase([many(30, { typeLine: 'Land', producedMana: 'C', manaValue: 0 }), many(10, { manaCost: '{2}', manaValue: 2 })], [], '');
    expect(report.colours).toEqual([]);
    expect(report.hardToCast).toEqual([]);
  });
});
