import type { RecMode, ScoreBreakdown, ScoreComponent } from '../contract';

export type ComponentValues = Record<ScoreComponent, number | null>;
export type ComponentWeights = Record<ScoreComponent, number>;

const COMPONENTS: readonly ScoreComponent[] = ['tag', 'manaValue', 'staple', 'corpus', 'votes', 'role'];

/**
 * Starting weights per mode; tuned later against the recommendation regression set.
 * Without play-rate or vote data, collection-less weights renormalize to tag 57%, staple 29%, mana value 14%.
 * rec_swap_candidates orders its candidate pool with the same no-corpus weights; change both together.
 */
export const SWAP_WEIGHTS: Record<RecMode, ComponentWeights> = {
  collection_less: { tag: 0.4, manaValue: 0.1, staple: 0.2, corpus: 0.2, votes: 0.1, role: 0 },
  collection_aware: { tag: 0.55, manaValue: 0.1, staple: 0.1, corpus: 0.15, votes: 0.1, role: 0 },
};

/** Candidates below this functional tag similarity don't do the same job and are dropped. */
export const TAG_SIMILARITY_FLOOR = 0.25;

/** A pair's votes reach half of their maximum weight at this many votes. */
export const VOTE_HALF_WEIGHT_COUNT = 25;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 1 for the same mana value, falling off smoothly (~0.51 at 1 apart, ~0.26 at 2 apart). */
export function manaValueProximity(candidate: number, target: number): number {
  return Math.exp(-Math.abs(candidate - target) / 1.5);
}

/**
 * Weighted sum of normalized components (never a product). Weights are renormalized over the components that
 * have data, so a missing corpus or zero votes don't pull every score down; vote weight ramps up with vote count.
 */
export function blendScore(components: ComponentValues, weights: ComponentWeights, voteCount = 0): ScoreBreakdown {
  const raw = {} as ComponentWeights;
  for (const k of COMPONENTS) {
    const weight = k === 'votes' ? weights.votes * (voteCount / (voteCount + VOTE_HALF_WEIGHT_COUNT)) : weights[k];
    raw[k] = components[k] === null ? 0 : weight;
  }
  const sum = COMPONENTS.reduce((acc, k) => acc + raw[k], 0);

  const effectiveWeights = {} as ComponentWeights;
  let total = 0;
  for (const k of COMPONENTS) {
    effectiveWeights[k] = sum > 0 ? raw[k] / sum : 0;
    total += effectiveWeights[k] * clamp01(components[k] ?? 0);
  }
  return { total: clamp01(total), components, effectiveWeights };
}
