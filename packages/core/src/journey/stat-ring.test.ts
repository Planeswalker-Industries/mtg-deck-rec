import { describe, expect, it } from 'vitest';
import { ringRange, ringWorsens, statRing } from './stat-ring';
import { withinTolerance } from './deck-tally';

describe('statRing', () => {
  // Target 10: tolerance 2, so the range is 8 to 12.
  it('fills the first lap toward the bottom of the range', () => {
    expect(statRing(6, 10, false)).toEqual({ zone: 'low', lap: 0.75, extra: 0 });
  });

  it('reads far short as severe, below 0.6 of the bottom', () => {
    // Bottom 8: severe under 4.8.
    expect(statRing(4, 10, false).zone).toBe('severe');
    expect(statRing(5, 10, false).zone).toBe('low');
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

  it('handles a target of 0: in line at 0 or 1, over past it', () => {
    // Target 0: the tolerance floor of 1 card gives the range 0 to 1.
    expect(statRing(0, 0, true)).toEqual({ zone: 'ok', lap: 1, extra: 0 });
    expect(statRing(1, 0, true)).toEqual({ zone: 'ok', lap: 1, extra: 1 });
    expect(statRing(2, 0, false)).toEqual({ zone: 'over', lap: 1, extra: 1 });
  });

  it('handles a fractional target, as 0.4 planeswalkers', () => {
    // Range 0 to 1.4: one planeswalker sits partway across it.
    const ring = statRing(1, 0.4, withinTolerance(1, 0.4));
    expect(ring.zone).toBe('ok');
    expect(ring.extra).toBeCloseTo(1 / 1.4);
    expect(statRing(2, 0.4, withinTolerance(2, 0.4)).zone).toBe('over');
  });

  it('never divides by zero on a minimum line with target 0', () => {
    expect(statRing(0, 0, true, true)).toEqual({ zone: 'ok', lap: 1, extra: 0 });
    expect(statRing(0, 0, false, true)).toEqual({ zone: 'low', lap: 0, extra: 0 });
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

  it('gives whole counts for a target of 0 and a fractional one', () => {
    expect(ringRange(0)).toEqual({ low: 0, high: 1 });
    expect(ringRange(0.4)).toEqual({ low: 0, high: 1 });
    expect(ringRange(0.4, true)).toEqual({ low: 1, high: null });
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
