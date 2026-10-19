import { describe, expect, it } from 'vitest';
import type { CardId } from '../contract';
import { lastResortCuts, trimCuts, type RoomCard, type RoomRole } from './room';

const REMOVAL = 'removal';
const PROTECTION = 'protection';
const RAMP = 'ramp';
const DRAW = 'draw';

const card = (id: number, over: Partial<RoomCard> = {}): RoomCard => ({ id: id as CardId, isLand: false, manaValue: 3, roles: [], ...over });

/** The owner's Liesa deck after Add: far too much removal, protection still short. */
const roles: RoomRole[] = [
  { roleId: REMOVAL, value: 22, target: 9 },
  { roleId: PROTECTION, value: 3, target: 8 },
  { roleId: RAMP, value: 10, target: 10 },
  { roleId: DRAW, value: 10, target: 10 },
];

const base = { roles, landsOver: false, spared: new Set<CardId>() };

describe('trimCuts', () => {
  it('trims the over-full role first: listed surplus cards, then the rest of the list, then unlisted surplus dearest first', () => {
    const cards = [
      card(1, { roles: [REMOVAL], manaValue: 2 }),
      card(2, { roles: [REMOVAL], manaValue: 6 }),
      card(3, { roles: [REMOVAL] }),
      card(4, { roles: [DRAW] }),
      card(5, { roles: [RAMP] }),
    ];
    const cutScores = new Map<CardId, number>([
      [3 as CardId, 0.3],
      [4 as CardId, 0.9],
    ]);
    // 3 is listed and all-removal; 4 is listed but draw is on target; 2 and 1 are unlisted removal, dearest first; 5 is neither.
    expect(trimCuts({ ...base, cards, cutScores })).toEqual([3, 4, 2, 1]);
  });

  it('never offers a card that fills a role the deck is short of, even one on the cut list', () => {
    const cards = [card(1, { roles: [REMOVAL, PROTECTION] }), card(2, { roles: [REMOVAL] })];
    const cutScores = new Map<CardId, number>([[1 as CardId, 0.9]]);
    expect(trimCuts({ ...base, cards, cutScores })).toEqual([2]);
  });

  it('leaves lands alone unless the deck has too many, and skips spared cards', () => {
    const cards = [card(1, { isLand: true, roles: [REMOVAL] }), card(2, { roles: [REMOVAL] }), card(3, { roles: [REMOVAL] })];
    const spared = new Set<CardId>([3 as CardId]);
    expect(trimCuts({ ...base, cards, cutScores: new Map(), spared })).toEqual([2]);
    expect(trimCuts({ ...base, cards, cutScores: new Map(), spared, landsOver: true })).toEqual([1, 2]);
  });

  it('narrows to one role when the player asks to trim it', () => {
    const cards = [card(1, { roles: [REMOVAL] }), card(2, { roles: [DRAW] })];
    const cutScores = new Map<CardId, number>([[2 as CardId, 0.9]]);
    expect(trimCuts({ ...base, cards, cutScores, focusRoleId: REMOVAL })).toEqual([1]);
  });
});

describe('lastResortCuts', () => {
  it('offers the other cards strongest cut first, never lands, and cards filling a short role last', () => {
    const cards = [
      card(1, { isLand: true }),
      card(3, { roles: [PROTECTION], manaValue: 7 }),
      card(4, { roles: [DRAW], manaValue: 2 }),
      card(5, { roles: [RAMP], manaValue: 5 }),
      card(6, { roles: [DRAW] }),
    ];
    const cutScores = new Map<CardId, number>([[6 as CardId, 0.4]]);
    // 6 is listed; 5 and 4 unlisted, dearest first; 3 fills short protection, so last; the land is left to the land counts.
    expect(lastResortCuts({ cards, roles, cutScores, spared: new Set() })).toEqual([6, 5, 4, 3]);
  });

  it('never offers a spared card', () => {
    const cards = [card(1), card(2)];
    expect(lastResortCuts({ cards, roles, cutScores: new Map(), spared: new Set([1 as CardId]) })).toEqual([2]);
  });
});
