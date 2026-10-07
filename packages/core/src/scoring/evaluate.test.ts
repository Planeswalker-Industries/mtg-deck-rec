import { describe, expect, it } from 'vitest';
import {
  bootstrapDifference,
  bootstrapMean,
  evaluateGate,
  isHeldOut,
  precisionAt,
  recallAt,
  sample,
  seededRandom,
  sizeBucket,
  weightedSample,
} from './evaluate';

describe('evaluation helpers', () => {
  it('draws the same sequence from the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });

  it('holds out about the share asked for, the same decks every run', () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `archidekt:${i}`);
    const held = ids.filter((id) => isHeldOut(id, 42, 0.1));
    expect(held.length / ids.length).toBeGreaterThan(0.08);
    expect(held.length / ids.length).toBeLessThan(0.12);
    expect(ids.filter((id) => isHeldOut(id, 42, 0.1))).toEqual(held);
  });

  it('samples without repeats, and weighted draws favour heavy items', () => {
    const picked = sample([1, 2, 3, 4, 5], 3, seededRandom(1));
    expect(new Set(picked).size).toBe(3);
    expect(sample([1, 2], 5, seededRandom(1)).sort()).toEqual([1, 2]);
    const counts = new Map<number, number>();
    const random = seededRandom(3);
    for (let i = 0; i < 500; i++) {
      for (const x of weightedSample([1, 2], (x) => (x === 1 ? 9 : 1), 1, random)) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    expect(counts.get(1) ?? 0).toBeGreaterThan((counts.get(2) ?? 0) * 4);
    expect(weightedSample([1, 2], () => 0, 1, random)).toEqual([]);
  });

  it('grades recall and precision on the top k', () => {
    expect(recallAt([1, 2, 3, 4], new Set([2, 4, 9]), 3)).toBeCloseTo(1 / 3);
    expect(precisionAt([1, 2, 3, 4], new Set([2, 4]), 2)).toBe(0.5);
    expect(recallAt([1], new Set(), 3)).toBe(0);
  });

  it('buckets commanders by their training decks', () => {
    expect(sizeBucket(120, [50, 10])).toBe('50+');
    expect(sizeBucket(10, [50, 10])).toBe('10-49');
    expect(sizeBucket(3, [50, 10])).toBe('under 10');
  });

  it('puts a clear gain above zero and a coin flip across it', () => {
    const baseline = Array.from({ length: 200 }, (_, i) => (i % 10) / 10);
    const better = baseline.map((b) => b + 0.05);
    expect(bootstrapDifference(baseline, better, 1000, 1).low).toBeGreaterThan(0);
    const noisy = baseline.map((b, i) => b + (i % 2 === 0 ? 0.05 : -0.05));
    const d = bootstrapDifference(baseline, noisy, 1000, 1);
    expect(d.low).toBeLessThan(0);
    expect(d.high).toBeGreaterThan(0);
    const m = bootstrapMean([0.2, 0.4, 0.6], 500, 2);
    expect(m.mean).toBeCloseTo(0.4);
    expect(m.low).toBeLessThanOrEqual(m.high);
  });

  it('passes a gain that keeps every bucket and the staple rate, and fails one that raises staples too far', () => {
    const baseline = Array.from({ length: 100 }, (_, i) => (i % 5) / 10);
    const candidate = baseline.map((b) => b + 0.04);
    const interval = bootstrapMean(baseline, 500, 3);
    const input = {
      baselineRecall: baseline,
      candidateRecall: candidate,
      buckets: [{ bucket: '50+', baseline: interval, candidateMean: interval.mean + 0.04 }],
      baselineStapleRate: 0.3,
      candidateStapleRate: 0.31,
      solRingTolerance: 0.02,
      resamples: 500,
      seed: 4,
      minCommanders: 50,
    };
    expect(evaluateGate(input).pass).toBe(true);
    expect(evaluateGate({ ...input, candidateStapleRate: 0.4 }).pass).toBe(false);
    // Too few commanders to judge, however clear the gain looks.
    expect(evaluateGate({ ...input, baselineRecall: baseline.slice(0, 5), candidateRecall: candidate.slice(0, 5) }).pass).toBe(false);
  });
});
