import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPORTS_DIR } from '../lib/config';
import { loadCatalog, loadCorpusConfig, loadCorpusDecks, resolveDeck, shrunkInclusion } from '../lib/corpus';
import { connect } from '../lib/db';
import { median, quantile, random, shuffled, spearman } from './corpus-stability';

/*
 * Slice 11's gate (docs/roadmap/card-graph-plan.md, "External statistics"): does EDHREC make a better prior than the
 * colour baseline for a commander with few decks of its own?
 *
 * For each commander with plenty of our decks, hide most of them as the answer key and keep a pool to sample from.
 * Estimate every card's play rate from n sampled decks, shrunk toward one of two priors, and score each estimate
 * against the hidden decks:
 *   colour — (x + α·p0) / (n + α), p0 the card's baseline in decks its colours allow (what the app does today)
 *   edhrec — (x + α·p_ext) / (n + α), p_ext EDHREC's inclusion for this commander, p0 for cards EDHREC doesn't list
 * n = 0 is a commander with no decks of ours at all: the prior alone.
 *
 * Caveat: EDHREC aggregates Archidekt decks, so some hidden decks are inside EDHREC's sample. The report gives how much
 * bigger EDHREC's sample is than ours (12× at the least on 2026-09-28), which bounds the leak.
 */

const SAMPLE_SIZES = [0, 5, 10, 20, 30, 50];
/** Decks kept aside to sample from; the rest are the answer key. */
const POOL_DECKS = 50;
/** Answer keys smaller than this are too noisy to grade against (split-half ρ reaches 0.8 near 100 decks). */
const MIN_HIDDEN_DECKS = 150;
const TOP_K = 50;
const DEFAULT_REPEATS = 20;
const SEED = 20260928;
const PERCENT = 100;

const ARMS = ['colour', 'edhrec'] as const;
type Arm = (typeof ARMS)[number];
const METRICS = ['inclusion', 'synergy'] as const;
type Metric = (typeof METRICS)[number];

interface Scored {
  id: number;
  inclusion: number;
  synergy: number;
}

interface Trial {
  overlap: Record<Metric, number>;
  rho: Record<Metric, number>;
  /** Mean absolute error of estimated inclusion against the hidden decks, over every candidate card. */
  mae: number;
}

const topIds = (scores: readonly Scored[], metric: Metric) =>
  [...scores].sort((a, b) => b[metric] - a[metric] || a.id - b.id).slice(0, TOP_K).map((s) => s.id);

function counts(decks: readonly number[][]): Map<number, number> {
  const result = new Map<number, number>();
  for (const deck of decks) for (const id of deck) result.set(id, (result.get(id) ?? 0) + 1);
  return result;
}

function grade(estimate: readonly Scored[], truth: readonly Scored[]): Trial {
  const truthById = new Map(truth.map((s) => [s.id, s]));
  const estimateById = new Map(estimate.map((s) => [s.id, s]));
  const trial: Trial = { overlap: { inclusion: 0, synergy: 0 }, rho: { inclusion: 0, synergy: 0 }, mae: 0 };
  for (const metric of METRICS) {
    const topEstimate = topIds(estimate, metric);
    const topTruth = new Set(topIds(truth, metric));
    trial.overlap[metric] = topEstimate.filter((id) => topTruth.has(id)).length / TOP_K;
    const union = [...new Set([...topEstimate, ...topTruth])];
    trial.rho[metric] = spearman(
      union.map((id) => estimateById.get(id)?.[metric] ?? 0),
      union.map((id) => truthById.get(id)?.[metric] ?? 0),
    );
  }
  trial.mae = estimate.reduce((sum, s) => sum + Math.abs(s.inclusion - (truthById.get(s.id)?.inclusion ?? 0)), 0) / estimate.length;
  return trial;
}

export async function evaluateEdhrecPrior({
  repeats = DEFAULT_REPEATS,
}: { repeats?: number | undefined } = {}): Promise<void> {
  const sql = connect();
  const decksByKey = new Map<string, { slug: string; decks: number[][] }>();
  const edhrecByKey = new Map<string, Map<number, number>>();
  const edhrecDecks = new Map<string, number>();
  let baseline: Map<number, number>;
  let alpha: number;
  try {
    const config = await loadCorpusConfig(sql);
    alpha = config.shrinkAlpha;
    const catalog = await loadCatalog(sql);
    const rates = await sql<{ card_id: number; rate: number }[]>`select card_id, rate from public.card_global_stats`;
    if (rates.length === 0) throw new Error('No card baselines yet. Run aggregate:corpus first.');
    baseline = new Map(rates.map((r) => [r.card_id, r.rate]));

    const seen = new Set<string>();
    for await (const deck of loadCorpusDecks(sql)) {
      const deckKey = `${deck.source}:${deck.id}`;
      if (seen.has(deckKey)) continue;
      seen.add(deckKey);
      const resolved = resolveDeck(deck, catalog, config);
      if (!resolved.ok) continue;
      const entry = decksByKey.get(resolved.deck.key) ?? { slug: resolved.deck.commanders.map((c) => c.slug).join('--'), decks: [] };
      entry.decks.push([...resolved.deck.cardIds]);
      decksByKey.set(resolved.deck.key, entry);
    }

    const external = await sql<{ commander_1: number; commander_2: number | null; deck_count: number; card_id: number; inclusion: number }[]>`
      select e.commander_1, e.commander_2, e.deck_count, s.card_id, s.decks_with::real / s.potential_decks as inclusion
      from public.external_commanders e
      join public.external_commander_card_stats s on s.external_commander_id = e.id
      where e.source = 'edhrec'
    `;
    if (external.length === 0) throw new Error('No EDHREC statistics yet. Run sync:edhrec first.');
    for (const row of external) {
      const key = row.commander_2 === null ? `${row.commander_1}` : `${row.commander_1}:${row.commander_2}`;
      let cards = edhrecByKey.get(key);
      if (!cards) edhrecByKey.set(key, (cards = new Map()));
      cards.set(row.card_id, row.inclusion);
      edhrecDecks.set(key, row.deck_count);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  const keys = [...decksByKey].filter(([key, k]) => k.decks.length >= POOL_DECKS + MIN_HIDDEN_DECKS && edhrecByKey.has(key));
  const noEdhrec = [...decksByKey].filter(([key, k]) => k.decks.length >= POOL_DECKS + MIN_HIDDEN_DECKS && !edhrecByKey.has(key)).length;
  const next = random(SEED);
  // size → arm → per commander → trials
  const trials = new Map(SAMPLE_SIZES.map((n) => [n, { colour: [] as Trial[][], edhrec: [] as Trial[][] }]));
  const edhrecListed: number[] = [];
  const sampleRatios: number[] = [];
  const started = Date.now();

  for (const [key, { decks }] of keys) {
    const edhrec = edhrecByKey.get(key) ?? new Map<number, number>();
    const candidates = [...new Set([...decks.flat(), ...edhrec.keys()])];
    edhrecListed.push(edhrec.size);
    sampleRatios.push((edhrecDecks.get(key) ?? 0) / decks.length);
    const perSize = new Map(SAMPLE_SIZES.map((n) => [n, { colour: [] as Trial[], edhrec: [] as Trial[] }]));

    for (let r = 0; r < repeats; r++) {
      const order = shuffled(decks, next);
      const pool = order.slice(0, POOL_DECKS);
      const hidden = order.slice(POOL_DECKS);
      const hiddenCounts = counts(hidden);
      const truth = candidates.map((id) => {
        const inclusion = (hiddenCounts.get(id) ?? 0) / hidden.length;
        return { id, inclusion, synergy: inclusion - (baseline.get(id) ?? 0) };
      });

      for (const n of SAMPLE_SIZES) {
        const sampleCounts = counts(pool.slice(0, n));
        const estimate = (arm: Arm): Scored[] =>
          candidates.map((id) => {
            const p0 = baseline.get(id) ?? 0;
            const prior = arm === 'edhrec' ? (edhrec.get(id) ?? p0) : p0;
            const inclusion = shrunkInclusion(sampleCounts.get(id) ?? 0, n, prior, alpha);
            return { id, inclusion, synergy: inclusion - p0 };
          });
        const slot = perSize.get(n);
        for (const arm of ARMS) slot?.[arm].push(grade(estimate(arm), truth));
      }
    }
    for (const n of SAMPLE_SIZES) {
      const slot = perSize.get(n);
      for (const arm of ARMS) if (slot) trials.get(n)?.[arm].push(slot[arm]);
    }
  }

  // Median over repeats per commander, then median across commanders; "wins" counts commanders where EDHREC's median beats colour's.
  const perCommander = (n: number, arm: Arm, pick: (t: Trial) => number) => (trials.get(n)?.[arm] ?? []).map((ts) => median(ts.map(pick)));
  const rows = SAMPLE_SIZES.map((n) => {
    const summary = (pick: (t: Trial) => number, lowerIsBetter = false) => {
      const colour = perCommander(n, 'colour', pick);
      const edhrec = perCommander(n, 'edhrec', pick);
      const wins = edhrec.filter((e, i) => (lowerIsBetter ? e < (colour[i] ?? 0) : e > (colour[i] ?? 0))).length;
      return { colour: median(colour), edhrec: median(edhrec), edhrecP10: quantile(edhrec, 0.1), wins };
    };
    return {
      n,
      overlapSynergy: summary((t) => t.overlap.synergy),
      overlapInclusion: summary((t) => t.overlap.inclusion),
      rhoSynergy: summary((t) => t.rho.synergy),
      mae: summary((t) => t.mae, true),
    };
  });

  const f2 = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(2));
  const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
  const f3 = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(3));
  const pct = (x: number) => (Number.isNaN(x) ? '-' : `${(x * PERCENT).toFixed(1)}%`);
  const date = new Date().toISOString().slice(0, 10);
  const total = keys.length;
  const report = [
    `# EDHREC prior vs colour baseline (${date})`,
    '',
    `Holdout test for card-graph-plan slice 11. For each of ${total} commanders with at least ${POOL_DECKS + MIN_HIDDEN_DECKS} of our decks`,
    `and an EDHREC page, ${repeats} times: shuffle the decks, keep ${POOL_DECKS} to sample from and hide the rest as the answer key.`,
    `Estimate every card's inclusion from n sampled decks, shrunk (α = ${alpha}) toward either the colour baseline p0 (today) or`,
    `EDHREC's inclusion for that commander (p0 where EDHREC doesn't list the card), and grade against the hidden decks.`,
    `Synergy = inclusion − p0 in both arms. Medians over repeats per commander, then across commanders. "EDHREC better" counts`,
    `commanders whose median beats colour's. Deck data from [Archidekt](https://archidekt.com), statistics from [EDHREC](https://edhrec.com).`,
    '',
    `- Commanders measured: ${total}${noEdhrec > 0 ? ` (${noEdhrec} more had enough decks but no EDHREC page)` : ''}. Cards EDHREC lists per commander: median ${Math.round(median(edhrecListed))}.`,
    `- Caveat: EDHREC aggregates Archidekt decks, so some hidden decks are inside its sample. Its samples here are ${f1(Math.min(...sampleRatios))}×`,
    `  ours at the least (median ${f1(median(sampleRatios))}×), so the leak is small, but it flatters EDHREC slightly.`,
    '',
    `## Top-${TOP_K} by synergy (what "High Synergy" and the add ranking lean on)`,
    '',
    '| Our decks (n) | Overlap, colour | Overlap, EDHREC | EDHREC P10 | EDHREC better | ρ, colour | ρ, EDHREC |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.n} | ${pct(r.overlapSynergy.colour)} | ${pct(r.overlapSynergy.edhrec)} | ${pct(r.overlapSynergy.edhrecP10)} | ` +
        `${r.overlapSynergy.wins} of ${total} | ${f2(r.rhoSynergy.colour)} | ${f2(r.rhoSynergy.edhrec)} |`,
    ),
    '',
    `## Top-${TOP_K} by inclusion, and estimate error`,
    '',
    '| Our decks (n) | Overlap, colour | Overlap, EDHREC | EDHREC better | Mean abs. error, colour | Mean abs. error, EDHREC | EDHREC better |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.n} | ${pct(r.overlapInclusion.colour)} | ${pct(r.overlapInclusion.edhrec)} | ${r.overlapInclusion.wins} of ${total} | ` +
        `${f3(r.mae.colour)} | ${f3(r.mae.edhrec)} | ${r.mae.wins} of ${total} |`,
    ),
    '',
  ].join('\n');

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `edhrec-prior-${date}.md`);
  writeFileSync(reportFile, report);
  console.log(report);
  console.log(`${((Date.now() - started) / 1000).toFixed(1)} s → ${reportFile}`);
}
