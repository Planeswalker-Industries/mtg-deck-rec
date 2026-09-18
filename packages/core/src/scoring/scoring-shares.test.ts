import { describe, expect, it } from 'vitest';
import { blendScore, SWAP_WEIGHTS } from './swap';
import type { ComponentValues } from './swap';

/**
 * The "Why this card" panel claims each component is worth N% of the score, and those percentages have to add up.
 * That only holds because `blendScore` renormalizes its weights over the components that have data and computes the
 * total as the plain sum of value × weight. If either ever changes, the panel starts lying and this fails.
 */
describe('score shares', () => {
  const components: ComponentValues = { tag: 0.8, manaValue: 0.6, staple: 0.4, corpus: 0.5, votes: null, role: null };

  it('effective weights sum to 1 over the components that have data', () => {
    const { effectiveWeights } = blendScore(components, SWAP_WEIGHTS.collection_less);
    const sum = Object.values(effectiveWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('gives a component with no data no weight at all', () => {
    const { effectiveWeights } = blendScore(components, SWAP_WEIGHTS.collection_less);
    expect(effectiveWeights.votes).toBe(0);
    expect(effectiveWeights.role).toBe(0);
  });

  it('adds the per-component contributions up to the total, so the shares reach 100%', () => {
    const score = blendScore(components, SWAP_WEIGHTS.collection_less);
    const contributions = Object.entries(score.effectiveWeights).map(
      ([key, weight]) => weight * (score.components[key as keyof ComponentValues] ?? 0),
    );
    const summed = contributions.reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(score.total, 10);

    const shares = contributions.map((c) => c / score.total);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('holds when votes carry weight, which ramps up with the vote count', () => {
    const withVotes: ComponentValues = { ...components, votes: 0.9 };
    const score = blendScore(withVotes, SWAP_WEIGHTS.collection_less, 75);
    expect(score.effectiveWeights.votes).toBeGreaterThan(0);
    const summed = Object.entries(score.effectiveWeights).reduce(
      (acc, [key, weight]) => acc + weight * (score.components[key as keyof ComponentValues] ?? 0),
      0,
    );
    expect(summed).toBeCloseTo(score.total, 10);
  });
});
