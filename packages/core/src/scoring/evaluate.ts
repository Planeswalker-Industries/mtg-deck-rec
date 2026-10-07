/**
 * Pure pieces of the offline evaluation (T058; scoring-design.md, "Evaluation"): a seeded generator, the holdout split,
 * the metrics and the bootstrap. The worker's `eval:holdout` job loads the data and calls these, so everything that
 * decides a gate result is tested here.
 */

/** A 32-bit generator's outputs, divided by this, fall in [0, 1). */
const UINT32_RANGE = 2 ** 32;
/** FNV-1a's 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** The two tails a 95% interval leaves out. */
const LOWER_QUANTILE = 0.025;
const UPPER_QUANTILE = 0.975;

/** mulberry32: a small seeded generator, so every sample can be drawn again. Its shifts and constants are the published ones. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** FNV-1a over a string, in [0, 1): where a deck falls in the split, the same on every run with the same seed. */
export function stableUnit(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h / UINT32_RANGE;
}

/** Whether a deck is held out: its id hashed with the seed, against the held-out share. */
export function isHeldOut(deckId: string, seed: number, share: number): boolean {
  return stableUnit(`${seed}:${deckId}`) < share;
}

/** `count` distinct items drawn without replacement, in draw order (all of them when there are fewer). */
export function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.floor(random() * pool.length);
    out.push(pool[i] as T);
    pool[i] = pool[pool.length - 1] as T;
    pool.pop();
  }
  return out;
}

/**
 * `count` distinct items drawn without replacement, each draw weighted by `weight` (popular cards more often). Items
 * with no weight are never drawn.
 */
export function weightedSample<T>(items: readonly T[], weight: (item: T) => number, count: number, random: () => number): T[] {
  const pool = items.map((item) => ({ item, w: Math.max(0, weight(item)) })).filter((e) => e.w > 0);
  let total = pool.reduce((sum, e) => sum + e.w, 0);
  const out: T[] = [];
  while (out.length < count && pool.length > 0 && total > 0) {
    let r = random() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= pool[i]?.w ?? 0;
      if (r < 0) break;
    }
    const [picked] = pool.splice(i, 1);
    if (!picked) break;
    out.push(picked.item);
    total -= picked.w;
  }
  return out;
}

/** Share of the hidden cards found among the first `k` suggestions. */
export function recallAt(ranked: readonly number[], hidden: ReadonlySet<number>, k: number): number {
  if (hidden.size === 0) return 0;
  return ranked.slice(0, k).filter((id) => hidden.has(id)).length / hidden.size;
}

/** Share of the first `k` suggestions that are planted cards. */
export function precisionAt(ranked: readonly number[], planted: ReadonlySet<number>, k: number): number {
  if (k <= 0) return 0;
  return ranked.slice(0, k).filter((id) => planted.has(id)).length / k;
}

/** Which size bucket a commander's training deck count falls in: '50+', '10-49', 'under 10' for edges [50, 10]. */
export function sizeBucket(trainingDecks: number, [high, low]: readonly [number, number]): string {
  if (trainingDecks >= high) return `${high}+`;
  if (trainingDecks >= low) return `${low}-${high - 1}`;
  return `under ${low}`;
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i] ?? 0;
}

export interface Interval {
  mean: number;
  low: number;
  high: number;
  /** Half the 95% interval's width. */
  halfWidth: number;
}

/** A mean and its 95% bootstrap interval over `values` (one per commander), resampled `resamples` times. */
export function bootstrapMean(values: readonly number[], resamples: number, seed: number): Interval {
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)] ?? 0;
    means.push(values.length === 0 ? 0 : sum / values.length);
  }
  means.sort((a, b) => a - b);
  const low = quantile(means, LOWER_QUANTILE);
  const high = quantile(means, UPPER_QUANTILE);
  return { mean: mean(values), low, high, halfWidth: (high - low) / 2 };
}

/**
 * The mean paired difference (candidate − baseline) over commanders and its 95% bootstrap interval: the same commanders
 * resampled together, so the interval reflects the change rather than which commanders happened to be drawn.
 */
export function bootstrapDifference(
  baseline: readonly number[],
  candidate: readonly number[],
  resamples: number,
  seed: number,
): Interval {
  if (baseline.length !== candidate.length) throw new Error('paired samples need the same commanders');
  return bootstrapMean(
    baseline.map((b, i) => (candidate[i] ?? 0) - b),
    resamples,
    seed,
  );
}

export interface GateInput {
  /** Per commander, the same order in both. */
  baselineRecall: readonly number[];
  candidateRecall: readonly number[];
  /** Per bucket: the baseline's mean and interval, and the candidate's mean. */
  buckets: readonly { bucket: string; baseline: Interval; candidateMean: number }[];
  baselineStapleRate: number;
  candidateStapleRate: number;
  solRingTolerance: number;
  resamples: number;
  seed: number;
  /** Fewer commanders than this fail the gate: too few to judge. */
  minCommanders: number;
}

export interface GateResult {
  pass: boolean;
  difference: Interval;
  checks: { name: string; pass: boolean; detail: string }[];
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/**
 * scoring-design.md's gate: overall recall@k rises with a 95% interval above zero, no bucket falls by more than its own
 * interval's half-width, and the Sol Ring rate rises by no more than the tolerance. The regression fixtures are the
 * fourth check, run separately (`yarn workspace @mtg/web regress`).
 */
export function evaluateGate(input: GateInput): GateResult {
  const difference = bootstrapDifference(input.baselineRecall, input.candidateRecall, input.resamples, input.seed);
  const checks: GateResult['checks'] = [
    {
      name: 'enough commanders',
      pass: input.baselineRecall.length >= input.minCommanders,
      detail: `${input.baselineRecall.length} held-out commanders (at least ${input.minCommanders})`,
    },
    {
      name: 'recall rises',
      pass: difference.low > 0,
      detail: `${pct(difference.mean)} (95% interval ${pct(difference.low)} to ${pct(difference.high)})`,
    },
    ...input.buckets.map((b) => ({
      name: `bucket ${b.bucket} holds`,
      pass: b.candidateMean >= b.baseline.mean - b.baseline.halfWidth,
      detail: `${pct(b.baseline.mean)} → ${pct(b.candidateMean)} (allowed down to ${pct(b.baseline.mean - b.baseline.halfWidth)})`,
    })),
    {
      name: 'Sol Ring rate',
      pass: input.candidateStapleRate - input.baselineStapleRate <= input.solRingTolerance,
      detail: `${pct(input.baselineStapleRate)} → ${pct(input.candidateStapleRate)} (tolerance ${pct(input.solRingTolerance)})`,
    },
  ];
  return { pass: checks.every((c) => c.pass), difference, checks };
}
