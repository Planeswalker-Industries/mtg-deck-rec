import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPORTS_DIR } from '../lib/config';
import { DEFAULT_CORPUS_FILE, loadCatalog, loadCorpusConfig, resolveDeck, shrunkInclusion } from '../lib/corpus';
import { connect } from '../lib/db';
import { readJsonl } from '../lib/jsonl';
import type { SlimDeck } from '../sources/archidekt/deck';

/*
 * Phase 0: how many decks a commander needs before its card rankings stop changing with the sample. For each commander
 * with enough decks, repeatedly draw two disjoint samples of n decks and compare the two top-50 rankings they produce.
 * Two independent samples agreeing is a stricter test than one sample agreeing with the full set, and it doesn't need
 * a "true" ranking we don't have.
 */

const SAMPLE_SIZES = [10, 20, 30, 50, 75, 100, 125, 150];
const TOP_K = 50;
/** Only cards near the top of the full ranking can reach a sample's top 50; scoring just these keeps the job fast. */
const CANDIDATES_PER_METRIC = 300;
/** A sample size measured on fewer commanders than this is reported but not used for suggestions. */
const MIN_COMMANDERS_PER_SIZE = 10;
/** Split-half agreement thresholds for "some corpus signal" and "full corpus weight". */
const MIN_RHO = 0.6;
const FULL_RHO = 0.8;

const METRICS = ['inclusion', 'synergy'] as const;
type Metric = (typeof METRICS)[number];

interface KeyDecks {
  slug: string;
  decks: number[][];
}

interface Trial {
  rho: Record<Metric, number>;
  overlap: Record<Metric, number>;
}

/** Deterministic PRNG (mulberry32) so a re-run reproduces the report. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}

/** Ranks with ties sharing their average rank. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.value === order[i]?.value) j++;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k]?.index ?? 0] = average;
    i = j + 1;
  }
  return result;
}

function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (ra.length + 1) / 2;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < ra.length; i++) {
    const da = (ra[i] ?? 0) - mean;
    const db = (rb[i] ?? 0) - mean;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (position - low);
}

const median = (values: readonly number[]) => quantile(values, 0.5);

export async function measureCorpusStability({
  file = DEFAULT_CORPUS_FILE,
  repeats = 30,
  seed = 20260914,
}: { file?: string | undefined; repeats?: number | undefined; seed?: number | undefined } = {}): Promise<void> {
  const sql = connect();
  const byKey = new Map<string, KeyDecks>();
  let baseline: Map<number, number>;
  let alpha: number;
  try {
    const config = await loadCorpusConfig(sql);
    alpha = config.shrinkAlpha;
    const catalog = await loadCatalog(sql);
    const rates = await sql<{ card_id: number; rate: number }[]>`select card_id, rate from public.card_global_stats`;
    if (rates.length === 0) throw new Error('No card baselines yet. Run aggregate:corpus first.');
    baseline = new Map(rates.map((r) => [r.card_id, r.rate]));

    const seen = new Set<number>();
    for await (const deck of readJsonl<SlimDeck>(file)) {
      if (seen.has(deck.id)) continue;
      seen.add(deck.id);
      const resolved = resolveDeck(deck, catalog, config);
      if (!resolved.ok) continue;
      const entry = byKey.get(resolved.deck.key) ?? { slug: resolved.deck.commanders.map((c) => c.slug).join('--'), decks: [] };
      entry.decks.push([...resolved.deck.cardIds]);
      byKey.set(resolved.deck.key, entry);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  const smallest = SAMPLE_SIZES[0] ?? 10;
  const keys = [...byKey.values()].filter((k) => k.decks.length >= 2 * smallest);
  const next = random(seed);
  const trials = new Map<number, Trial[][]>(SAMPLE_SIZES.map((n) => [n, []]));
  const started = Date.now();

  const scoresFor = (decks: readonly number[][], candidates: readonly number[]) => {
    const counts = new Map<number, number>();
    for (const deck of decks) for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    return candidates.map((id) => {
      const p0 = baseline.get(id) ?? 0;
      const inclusion = shrunkInclusion(counts.get(id) ?? 0, decks.length, p0, alpha);
      return { id, inclusion, synergy: inclusion - p0 };
    });
  };
  const topIds = (scores: readonly { id: number; inclusion: number; synergy: number }[], metric: Metric, k: number) =>
    [...scores].sort((a, b) => b[metric] - a[metric] || a.id - b.id).slice(0, k).map((s) => s.id);

  for (const key of keys) {
    // Candidates: the cards near the top of this commander's full ranking under either metric.
    const full = scoresFor(key.decks, [...new Set(key.decks.flat())]);
    const candidates = [...new Set(METRICS.flatMap((m) => topIds(full, m, CANDIDATES_PER_METRIC)))];

    for (const n of SAMPLE_SIZES) {
      if (key.decks.length < 2 * n) continue;
      const keyTrials: Trial[] = [];
      for (let r = 0; r < repeats; r++) {
        const order = shuffled(key.decks, next);
        const a = scoresFor(order.slice(0, n), candidates);
        const b = scoresFor(order.slice(n, 2 * n), candidates);
        const byIdA = new Map(a.map((s) => [s.id, s]));
        const byIdB = new Map(b.map((s) => [s.id, s]));
        const trial: Trial = { rho: { inclusion: 0, synergy: 0 }, overlap: { inclusion: 0, synergy: 0 } };
        for (const metric of METRICS) {
          const topA = topIds(a, metric, TOP_K);
          const topB = topIds(b, metric, TOP_K);
          const union = [...new Set([...topA, ...topB])];
          trial.rho[metric] = spearman(
            union.map((id) => byIdA.get(id)?.[metric] ?? 0),
            union.map((id) => byIdB.get(id)?.[metric] ?? 0),
          );
          const setB = new Set(topB);
          trial.overlap[metric] = topA.filter((id) => setB.has(id)).length / TOP_K;
        }
        keyTrials.push(trial);
      }
      trials.get(n)?.push(keyTrials);
    }
  }

  // Median over repeats per commander, then median and 10th percentile across commanders.
  const rows = SAMPLE_SIZES.map((n) => {
    const perKey = trials.get(n) ?? [];
    const keyMedian = (pick: (t: Trial) => number) => perKey.map((ts) => median(ts.map(pick)));
    const rhoInclusion = keyMedian((t) => t.rho.inclusion);
    const rhoSynergy = keyMedian((t) => t.rho.synergy);
    const overlapInclusion = keyMedian((t) => t.overlap.inclusion);
    const overlapSynergy = keyMedian((t) => t.overlap.synergy);
    return {
      n,
      commanders: perKey.length,
      rhoInclusion: median(rhoInclusion),
      rhoInclusionP10: quantile(rhoInclusion, 0.1),
      rhoSynergy: median(rhoSynergy),
      rhoSynergyP10: quantile(rhoSynergy, 0.1),
      overlapInclusion: median(overlapInclusion),
      overlapSynergy: median(overlapSynergy),
    };
  });

  const firstReaching = (threshold: number) =>
    rows.find((r) => r.commanders >= MIN_COMMANDERS_PER_SIZE && r.rhoSynergy >= threshold)?.n ?? null;
  const minDecks = firstReaching(MIN_RHO);
  const fullDecks = firstReaching(FULL_RHO);
  const fmt = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(2));
  const date = new Date().toISOString().slice(0, 10);

  const report = [
    `# Corpus stability (${date})`,
    '',
    `Split-half resampling: for each commander, ${repeats} times per sample size, two disjoint random samples of n decks each`,
    `rank cards by shrunk inclusion (α = ${alpha}) and by synergy (shrunk inclusion − baseline). Agreement is Spearman ρ over`,
    `the union of both top-${TOP_K} lists, and overlap is the share of top-${TOP_K} cards the two samples share. Medians over repeats`,
    `per commander, then median and 10th percentile across commanders. Deck data from [Archidekt](https://archidekt.com).`,
    '',
    `- Commanders measured: ${keys.length} (with at least ${2 * smallest} decks; larger n needs 2n decks). Sizes measured on fewer than ${MIN_COMMANDERS_PER_SIZE} commanders don't count toward the suggestions.`,
    `- Suggested minDecks (median synergy ρ ≥ ${MIN_RHO}): ${minDecks ?? `not reached by n = ${SAMPLE_SIZES.at(-1)}`}.`,
    `- Suggested fullDecks (median synergy ρ ≥ ${FULL_RHO}): ${fullDecks ?? `not reached by n = ${SAMPLE_SIZES.at(-1)}`}.`,
    '- Split-half agreement understates how well one sample of n matches the full population, so these are conservative.',
    '',
    '| Decks per sample (n) | Commanders | ρ inclusion (median) | ρ inclusion (P10) | ρ synergy (median) | ρ synergy (P10) | Top-50 overlap, inclusion | Top-50 overlap, synergy |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.n} | ${r.commanders} | ${fmt(r.rhoInclusion)} | ${fmt(r.rhoInclusionP10)} | ${fmt(r.rhoSynergy)} | ${fmt(r.rhoSynergyP10)} | ` +
        `${fmt(r.overlapInclusion)} | ${fmt(r.overlapSynergy)} |`,
    ),
    '',
  ].join('\n');

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `corpus-stability-${date}.md`);
  writeFileSync(reportFile, report);
  console.log(report);
  console.log(`${((Date.now() - started) / 1000).toFixed(1)} s → ${reportFile}`);
}
