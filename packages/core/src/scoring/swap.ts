import type { ScoreBreakdown, ScoreComponent } from '../contract';

/** A component left out counts as null: no data. */
export type ComponentValues = Partial<Record<ScoreComponent, number | null>>;
export type ComponentWeights = Record<ScoreComponent, number>;

const COMPONENTS: readonly ScoreComponent[] = ['tag', 'manaValue', 'staple', 'corpus', 'votes', 'role', 'curve', 'deck'];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 1 for the same mana value, falling off smoothly: exp(−|difference| / falloff) (`app_config.scoring.swap`). */
export function manaValueProximity(candidate: number, target: number, falloff: number): number {
  return Math.exp(-Math.abs(candidate - target) / falloff);
}

/** How much of the votes weight a pair has earned: count / (count + halfWeightCount). */
export interface VoteRamp {
  count: number;
  halfWeightCount: number;
}

/**
 * Weighted sum of normalized components (never a product). Weights are renormalized over the components that
 * have data, so a missing corpus or zero votes don't pull every score down; vote weight ramps up with vote count, and
 * without a ramp votes carry no weight.
 */
export function blendScore(components: ComponentValues, weights: ComponentWeights, votes?: VoteRamp): ScoreBreakdown {
  const voteShare = votes ? votes.count / (votes.count + votes.halfWeightCount) : 0;
  const values = Object.fromEntries(COMPONENTS.map((k) => [k, components[k] ?? null])) as Record<ScoreComponent, number | null>;
  const raw = {} as ComponentWeights;
  for (const k of COMPONENTS) {
    const weight = k === 'votes' ? weights.votes * voteShare : weights[k];
    raw[k] = values[k] === null ? 0 : weight;
  }
  const sum = COMPONENTS.reduce((acc, k) => acc + raw[k], 0);

  const effectiveWeights = {} as ComponentWeights;
  let total = 0;
  for (const k of COMPONENTS) {
    effectiveWeights[k] = sum > 0 ? raw[k] / sum : 0;
    total += effectiveWeights[k] * clamp01(values[k] ?? 0);
  }
  return { total: clamp01(total), components: values, effectiveWeights };
}
