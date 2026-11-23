import { describe, expect, it } from 'vitest';
import { ringRange, ringWorsens, statRing } from './stat-ring';
import { withinTolerance } from './deck-tally';

describe('statRing', () => {
  // Target 10: tolerance 2, so the range is 8 to 12.
  it('fills the first lap toward the bottom of the range', () => {
    expect(statRing(6, 10, false)).toEqual({ zone: 'low', lap: 0.75, extra: 0 });
  });

  it('reads far short as severe', () => {
    expect(statRing(3, 10, false).zone).toBe('severe');
  });

  it('closes at the bottom of the range and fills the second lap across it', () => {
    expect(statRing(8, 10, true)).toEqual({ zone: 'ok', lap: 1, extra: 0 });
    expect(statRing(10, 10, true)).toEqual({ zone: 'ok', lap: 1, extra: 0.5 });
    expect(statRing(12, 10, true)).toEqual({ zone: 'ok', lap: 1, extra: 1 });
  });

  it('is over past the top of the range', () => {
    expect(statRing(13, 10, false)).toEqual({ zone: 'over', lap: 1, extra: 1 });
  });

  it('agrees with withinTolerance at the range edges', () => {
    for (const value of [7, 8, 12, 13]) {
      expect(statRing(value, 10, withinTolerance(value, 10)).zone === 'ok').toBe(withinTolerance(value, 10));
    }
  });

  it('treats a range that starts at zero as closed when in line', () => {
    // Target 1, tolerance 1: 0 to 2 cards are in line.
    expect(statRing(0, 1, true)).toEqual({ zone: 'ok', lap: 1, extra: 0 });
  });

  it('closes a minimum line at its target, with no second lap and no top', () => {
    expect(statRing(21, 30, false, true)).toEqual({ zone: 'low', lap: 0.7, extra: 0 });
    expect(statRing(40, 30, true, true)).toEqual({ zone: 'ok', lap: 1, extra: 0 });
  });
});

describe('ringWorsens', () => {
  it('is true only on a step toward a bad end', () => {
    expect(ringWorsens('ok', 'low')).toBe(true);
    expect(ringWorsens('low', 'severe')).toBe(true);
    expect(ringWorsens('ok', 'over')).toBe(true);
    expect(ringWorsens('low', 'ok')).toBe(false);
    expect(ringWorsens('severe', 'over')).toBe(false);
  });
});

describe('ringRange', () => {
  it('gives the whole counts in line', () => {
    expect(ringRange(10)).toEqual({ low: 8, high: 12 });
    expect(ringRange(32)).toEqual({ low: 26, high: 38 });
    expect(ringRange(1)).toEqual({ low: 0, high: 2 });
    expect(ringRange(27, true)).toEqual({ low: 27, high: null });
  });

  it('agrees with withinTolerance', () => {
    for (const target of [1, 7, 10, 32, 35]) {
      const { low, high } = ringRange(target);
      expect(withinTolerance(low, target) && withinTolerance(high!, target)).toBe(true);
      expect(withinTolerance(high! + 1, target)).toBe(false);
      if (low > 0) expect(withinTolerance(low - 1, target)).toBe(false);
    }
  });
});
