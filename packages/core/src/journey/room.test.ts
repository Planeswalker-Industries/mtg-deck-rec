import { describe, expect, it } from 'vitest';
import type { CardId } from '../contract';
import { roomCuts, roomNeeded, type RoomCard, type RoomRole } from './room';

const REMOVAL = 'removal';
const RAMP = 'ramp';
const DRAW = 'draw';

const card = (id: number, over: Partial<RoomCard> = {}): RoomCard => ({ id: id as CardId, isLand: false, manaValue: 3, roles: [], ...over });

const roles: RoomRole[] = [
  { roleId: REMOVAL, value: 6, target: 9 },
  { roleId: RAMP, value: 14, target: 10 },
  { roleId: DRAW, value: 8, target: 10 },
];

describe('roomNeeded', () => {
  it('asks for what the role is short of', () => {
    expect(roomNeeded(roles, REMOVAL)).toBe(3);
  });

  it('asks for one when the role is already met, or unknown', () => {
    expect(roomNeeded(roles, RAMP)).toBe(1);
    expect(roomNeeded(roles, 'unknown')).toBe(1);
  });
});

describe('roomCuts', () => {
  const base = { focusRoleId: REMOVAL, roles, spared: new Set<CardId>() };

  it('offers cut-list cards first, strongest cut first, then surplus-role cards dearest first', () => {
    const cards = [
      card(1, { roles: [RAMP], manaValue: 2 }),
      card(2, { roles: [RAMP], manaValue: 5 }),
      card(3),
      card(4),
    ];
    const cutScores = new Map<CardId, number>([
      [3 as CardId, 0.4],
      [4 as CardId, 0.7],
    ]);
    expect(roomCuts({ ...base, cards, cutScores })).toEqual([4, 3, 2, 1]);
  });

  it('never offers a land or a card that fills the role being made room for', () => {
    const cards = [card(1, { isLand: true }), card(2, { roles: [REMOVAL] }), card(3, { roles: [REMOVAL, RAMP] })];
    const cutScores = new Map<CardId, number>([
      [1 as CardId, 0.9],
      [2 as CardId, 0.9],
      [3 as CardId, 0.9],
    ]);
    expect(roomCuts({ ...base, cards, cutScores })).toEqual([]);
  });

  it("leaves out cards the deck is built around: off the cut list and in a role that isn't over", () => {
    const cards = [card(1, { roles: [DRAW] }), card(2), card(3, { roles: [RAMP, DRAW] })];
    expect(roomCuts({ ...base, cards, cutScores: new Map() })).toEqual([]);
  });

  it('skips cards the player chose to keep', () => {
    const cards = [card(1, { roles: [RAMP] }), card(2, { roles: [RAMP] })];
    expect(roomCuts({ ...base, cards, cutScores: new Map(), spared: new Set([1 as CardId]) })).toEqual([2]);
  });
});
