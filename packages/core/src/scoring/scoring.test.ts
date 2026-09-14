import { describe, expect, it } from 'vitest';
import type { CardId } from '../contract';
import { HIGH_MANA_VALUE, scoreCuts, type CutCandidate, type RoleTarget } from './cut';
import { blendScore, manaValueProximity, SWAP_WEIGHTS } from './swap';

describe('blendScore', () => {
  it('renormalizes weights over the components that have data', () => {
    const score = blendScore({ tag: 1, manaValue: 0.5, corpus: null, votes: null }, SWAP_WEIGHTS.collection_less);
    expect(score.effectiveWeights.corpus).toBe(0);
    expect(score.effectiveWeights.votes).toBe(0);
    expect(score.effectiveWeights.tag + score.effectiveWeights.manaValue).toBeCloseTo(1);
    expect(score.total).toBeCloseTo((0.45 * 1 + 0.1 * 0.5) / 0.55);
  });

  it('gives votes no weight without votes and ramps them up with volume', () => {
    const base = { tag: 0.5, manaValue: 0.5, corpus: 0.5, votes: 1 };
    expect(blendScore(base, SWAP_WEIGHTS.collection_less, 0).effectiveWeights.votes).toBe(0);
    const few = blendScore(base, SWAP_WEIGHTS.collection_less, 5).effectiveWeights.votes;
    const many = blendScore(base, SWAP_WEIGHTS.collection_less, 500).effectiveWeights.votes;
    expect(few).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(few);
  });

  it('stays within 0..1 even with out-of-range inputs', () => {
    const score = blendScore({ tag: 3, manaValue: -1, corpus: null, votes: null }, SWAP_WEIGHTS.collection_aware);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });
});

describe('manaValueProximity', () => {
  it('is 1 at equal mana value and decreases with distance', () => {
    expect(manaValueProximity(3, 3)).toBe(1);
    expect(manaValueProximity(2, 3)).toBeGreaterThan(manaValueProximity(1, 3));
    expect(manaValueProximity(4, 3)).toBeCloseTo(manaValueProximity(2, 3));
  });
});

describe('scoreCuts', () => {
  let id = 1;
  const card = (overrides: Partial<CutCandidate> = {}): CutCandidate => ({
    cardId: id++ as CardId,
    manaValue: 2,
    isLand: false,
    isCommanderLegal: true,
    withinIdentity: true,
    gameChanger: false,
    roleIds: [],
    ...overrides,
  });
  const ramp: RoleTarget = { roleId: 'ramp', label: 'Ramp', target: 2 };
  const options = { includeGameChangers: true, gameChangerLimit: 3, roleTargets: [ramp] };

  it('puts rule problems first with a score of 1', () => {
    const offColor = card({ withinIdentity: false });
    const banned = card({ isCommanderLegal: false });
    const expensive = card({ manaValue: HIGH_MANA_VALUE });
    const [first, second, third] = scoreCuts([expensive, offColor, banned], options);
    expect(first?.cutScore).toBe(1);
    expect(second?.cutScore).toBe(1);
    expect(third?.cardId).toBe(expensive.cardId);
    expect(third?.reasons).toEqual(['HIGH_MANA_VALUE']);
  });

  it('flags a role only once it is clearly overloaded, and ranks expensive redundant cards higher', () => {
    const cheap = card({ roleIds: ['ramp'], manaValue: 1 });
    const pricey = card({ roleIds: ['ramp'], manaValue: 4 });
    expect(scoreCuts([cheap, pricey], options)).toEqual([]);

    const extra = card({ roleIds: ['ramp'], manaValue: 2 });
    const result = scoreCuts([cheap, pricey, extra], options);
    expect(result.map((r) => r.reasons)).toEqual([['ROLE_REDUNDANT'], ['ROLE_REDUNDANT'], ['ROLE_REDUNDANT']]);
    expect(result[0]?.cardId).toBe(pricey.cardId);
  });

  it('excludes Game Changers when toggled off and flags them over the bracket limit', () => {
    const gc = card({ gameChanger: true });
    expect(scoreCuts([gc], { ...options, includeGameChangers: false })[0]?.reasons).toEqual(['GAME_CHANGER_EXCLUDED']);
    const gcs = [card({ gameChanger: true }), card({ gameChanger: true })];
    expect(scoreCuts(gcs, { ...options, gameChangerLimit: 1 }).every((r) => r.reasons.includes('OVER_BRACKET_GC_LIMIT'))).toBe(true);
  });

  it('never flags lands as redundant or expensive, and leaves reasonless cards out', () => {
    const lands = [card({ isLand: true, roleIds: ['ramp'] }), card({ isLand: true, roleIds: ['ramp'] }), card({ isLand: true, roleIds: ['ramp'] })];
    expect(scoreCuts([...lands, card()], options)).toEqual([]);
  });
});
