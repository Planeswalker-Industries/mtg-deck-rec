import {
  addPoolScore,
  commanderShare,
  countsFromTotals,
  identityBaselineDecks,
  pickCorpusSources,
  servedCardRates,
  servedCorpusScore,
  sourceDeckTotals,
  type BaselineCounts,
  type CardFacts,
  type CorpusSources,
  type RowSums,
  type ServingSettings,
  type SourceDeckTotals,
} from '@mtg/core/scoring';
import { connect, reserve, type ReservedSql, type Sql } from '../lib/db';
import {
  copyRows,
  eligibleAt,
  loadBaselines,
  loadCardFacts,
  loadIdentityMonths,
  loadKeyRows,
  loadKeys,
  loadServingSettings,
  type KeyRow,
  type KeyRows,
} from '../lib/serving';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/** Commanders whose rows are merged per transaction: small enough that a merge holds its locks briefly. */
const SETS_PER_CHUNK = 200;
/** Scores moving less than this aren't rewritten, as aggregate:corpus treats shrunk inclusion and synergy. */
const SCORE_TOLERANCE = 0.001;
/** Counts are sums of 1s and partner weights: a difference this small is float noise, not a changed count. */
const COUNT_TOLERANCE = 1e-9;
/** A full run that would leave fewer rows than this share of the last full run's refuses, as the aggregate does. */
const MIN_ROW_SHARE = 0.8;
/** Where the stats come from, as sync_runs records it. */
const SCORES_URI = 'postgres:public.commander_card_stats';

/** A commander or pair the serving tables score. */
interface CommanderSet {
  commander1: number;
  /** 0 for a single commander. */
  commander2: number;
}

type ScoreRow = [number, number, number, number, number, number, number | null, number | null];

const SCORE_COLUMNS = ['commander_1', 'commander_2', 'card_id', 'decks_with', 'commander_decks', 'pool_score', 'corpus_value', 'weight_scale'];
const SET_COLUMNS = ['commander_1', 'commander_2', 'use_commander', 'has_sources'];

/** Every commander (or pair) the serving tables score: each key, and each commander of a pair on its own. */
function commanderSets(keys: readonly KeyRow[], only: ReadonlySet<number> | null): CommanderSet[] {
  const sets = new Map<string, CommanderSet>();
  const add = (commander1: number, commander2: number) => {
    if (only && !only.has(commander1) && !only.has(commander2)) return;
    sets.set(`${commander1}:${commander2}`, { commander1, commander2 });
  };
  for (const k of keys) {
    add(k.commander1, k.commander2 ?? 0);
    if (k.commander2 !== null) {
      add(k.commander1, 0);
      add(k.commander2, 0);
    }
  }
  return [...sets.values()].sort((a, b) => a.commander1 - b.commander1 || a.commander2 - b.commander2);
}

/**
 * Commanders that get partner_card_totals: those in a pair, and those who can take a partner, since a pair no key knows
 * is combined from its two partners' totals.
 */
function partnerCommanders(keys: readonly KeyRow[], only: ReadonlySet<number> | null): number[] {
  const ids = new Set<number>();
  for (const k of keys) {
    if (k.commander2 !== null) {
      ids.add(k.commander1);
      ids.add(k.commander2);
    } else if (k.partners) ids.add(k.commander1);
  }
  return [...ids].filter((id) => !only || only.has(id)).sort((a, b) => a - b);
}

interface Inputs {
  settings: Required<ServingSettings>;
  keysByCommander: Map<number, KeyRow[]>;
  rowsByKey: Map<number, KeyRows>;
  baselines: Map<number, BaselineCounts>;
  facts: Map<number, CardFacts>;
  identityMonths: Map<number, Record<string, number>>;
}

const UNKNOWN_CARD: CardFacts = { identity: 0, releaseMonth: null };

/** The keys whose decks count for a commander set, as the request picks them (pickCorpusSources). */
function pickSet(set: CommanderSet, inputs: Inputs): CorpusSources {
  const ids = set.commander2 === 0 ? [set.commander1] : [set.commander1, set.commander2];
  const involved = [...new Set(ids.flatMap((id) => inputs.keysByCommander.get(id) ?? []))].sort((a, b) => a.id - b.id);
  return pickCorpusSources(ids, involved, inputs.settings);
}

/**
 * Which pool a commander set's requests draw on (commander_sets): adds use its decks once they earn a share of the
 * score, as getAddSuggestions decided per request (commanderShare > 0); the rater and pages whenever any decks count.
 */
const setFlags = (set: CommanderSet, picked: CorpusSources, inputs: Inputs) =>
  [set.commander1, set.commander2, commanderShare(picked.effectiveDeckCount, inputs.settings) > 0, picked.sources.length > 0] as const;

/** One commander's (or pair's) rows: every card a source deck ran, scored as the request would score it. */
function* scoreRows(set: CommanderSet, picked: CorpusSources, inputs: Inputs): Generator<ScoreRow> {
  if (picked.sources.length === 0) return;
  const pooled = picked.borrowedDeckCount > 0;

  const sums = new Map<number, RowSums>();
  for (const source of picked.sources) {
    const rows = inputs.rowsByKey.get(source.id);
    if (!rows) continue;
    for (let i = 0; i < rows.cardIds.length; i++) {
      const cardId = rows.cardIds[i] ?? 0;
      let sum = sums.get(cardId);
      if (!sum) {
        sum = { decksWith: 0, tooEarly: 0 };
        sums.set(cardId, sum);
      }
      // keyRowSums, inlined: a million and a half rows per full run.
      sum.decksWith += source.weight * (rows.decksWith[i] ?? 0);
      sum.tooEarly += source.weight * (source.deckCount - (eligibleAt(rows, i) ?? source.deckCount));
    }
  }

  // The sources' deck totals depend only on a card's identity and release month.
  const totalsMemo = new Map<string, SourceDeckTotals>();
  for (const [cardId, sum] of sums) {
    const facts = inputs.facts.get(cardId) ?? UNKNOWN_CARD;
    const memoKey = `${facts.identity}:${facts.releaseMonth ?? ''}`;
    let totals = totalsMemo.get(memoKey);
    if (!totals) {
      totals = sourceDeckTotals(picked.sources, facts);
      totalsMemo.set(memoKey, totals);
    }
    const counts = countsFromTotals(totals, sum);
    const baseline = inputs.baselines.get(cardId) ?? {
      rate: 0,
      decksWith: 0,
      eligibleDecks: identityBaselineDecks(inputs.identityMonths, facts),
    };
    const score = servedCorpusScore(servedCardRates(counts, baseline, inputs.settings, pooled), inputs.settings);
    // The pool order reads the baseline as float4 cast to float8, as the retired rec_add_candidates did; fround gives
    // that exact value, so ties fall the same way.
    const poolScore = addPoolScore(counts, Math.fround(baseline.rate), inputs.settings.shrinkAlpha);
    yield [set.commander1, set.commander2, cardId, counts.decksWith, counts.commanderDecks, poolScore, score?.value ?? null, score?.weightScale ?? null];
  }
}

/** How many rows a commander set will have: the cards its sources ran. */
function setSize(set: CommanderSet, inputs: Inputs): number {
  const picked = pickSet(set, inputs);
  if (picked.sources.length === 1) return inputs.rowsByKey.get(picked.sources[0]?.id ?? 0)?.cardIds.length ?? 0;
  const cards = new Set<number>();
  for (const s of picked.sources) for (const id of inputs.rowsByKey.get(s.id)?.cardIds ?? []) cards.add(id);
  return cards.size;
}

/**
 * Stages one chunk of commander sets and merges it: rows that moved are rewritten, rows that went are removed, and each
 * set's commander_sets flags are written where they changed.
 */
async function mergeChunk(db: ReservedSql, chunk: readonly CommanderSet[], inputs: Inputs): Promise<{ staged: number; written: number; removed: number }> {
  await db`truncate stg_scores, stg_sets`;
  const picked = chunk.map((set) => ({ set, picked: pickSet(set, inputs) }));
  await copyRows(db, 'stg_sets', SET_COLUMNS, picked.map(({ set, picked: p }) => setFlags(set, p, inputs)));
  const staged = await copyRows(db, 'stg_scores', SCORE_COLUMNS, (function* () {
    for (const { set, picked: p } of picked) yield* scoreRows(set, p, inputs);
  })());
  await db`begin`;
  try {
    await db`
      insert into public.commander_sets as s (commander_1, commander_2, use_commander, has_sources)
      select commander_1, commander_2, use_commander, has_sources from stg_sets
      on conflict (commander_1, commander_2) do update set use_commander = excluded.use_commander, has_sources = excluded.has_sources
      where (s.use_commander, s.has_sources) is distinct from (excluded.use_commander, excluded.has_sources)
    `;
    const [removed] = await db<{ n: number }[]>`
      with gone as (
        delete from public.commander_card_scores s
        using stg_sets t
        where s.commander_1 = t.commander_1 and s.commander_2 = t.commander_2
          and not exists (
            select 1 from stg_scores n
            where n.commander_1 = s.commander_1 and n.commander_2 = s.commander_2 and n.card_id = s.card_id
          )
        returning 1
      )
      select count(*)::int as n from gone
    `;
    const [written] = await db<{ n: number }[]>`
      with changed as (
        insert into public.commander_card_scores as s
          (commander_1, commander_2, card_id, decks_with, commander_decks, pool_score, corpus_value, weight_scale)
        select commander_1, commander_2, card_id, decks_with, commander_decks, pool_score, corpus_value, weight_scale from stg_scores
        on conflict (commander_1, commander_2, card_id) do update set
          decks_with = excluded.decks_with,
          commander_decks = excluded.commander_decks,
          pool_score = excluded.pool_score,
          corpus_value = excluded.corpus_value,
          weight_scale = excluded.weight_scale
        where abs(s.decks_with - excluded.decks_with) > ${COUNT_TOLERANCE}
           or abs(s.commander_decks - excluded.commander_decks) > ${COUNT_TOLERANCE}
           or abs(s.pool_score - excluded.pool_score) >= ${SCORE_TOLERANCE}
           or (s.corpus_value is null) <> (excluded.corpus_value is null)
           or abs(s.corpus_value - excluded.corpus_value) >= ${SCORE_TOLERANCE}
           or (s.weight_scale is null) <> (excluded.weight_scale is null)
           or abs(s.weight_scale - excluded.weight_scale) >= ${SCORE_TOLERANCE}
        returning 1
      )
      select count(*)::int as n from changed
    `;
    await db`commit`;
    return { staged, written: written?.n ?? 0, removed: removed?.n ?? 0 };
  } catch (err) {
    await db`rollback`.catch(() => {});
    throw err;
  }
}

/** partner_card_totals for these commanders: every key each leads or shares, at full weight. */
async function mergePartnerTotals(
  db: ReservedSql,
  commanders: readonly number[],
  inputs: Inputs,
  full: boolean,
): Promise<{ staged: number; written: number; removed: number }> {
  await db`create temp table if not exists stg_totals (commander_id integer not null, card_id integer not null, decks_with integer not null, too_early integer not null)`;
  await db`create temp table if not exists stg_commanders (commander_id integer primary key)`;
  await db`truncate stg_totals, stg_commanders`;
  await copyRows(db, 'stg_commanders', ['commander_id'], commanders.map((id) => [id]));
  const staged = await copyRows(db, 'stg_totals', ['commander_id', 'card_id', 'decks_with', 'too_early'], (function* () {
    for (const commander of commanders) {
      const totals = new Map<number, RowSums>();
      for (const key of inputs.keysByCommander.get(commander) ?? []) {
        const rows = inputs.rowsByKey.get(key.id);
        if (!rows) continue;
        for (let i = 0; i < rows.cardIds.length; i++) {
          const cardId = rows.cardIds[i] ?? 0;
          const t = totals.get(cardId) ?? { decksWith: 0, tooEarly: 0 };
          t.decksWith += rows.decksWith[i] ?? 0;
          t.tooEarly += key.deckCount - (eligibleAt(rows, i) ?? key.deckCount);
          totals.set(cardId, t);
        }
      }
      for (const [cardId, t] of totals) yield [commander, cardId, t.decksWith, t.tooEarly];
    }
  })());
  await db`begin`;
  try {
    const [removed] = await db<{ n: number }[]>`
      with gone as (
        delete from public.partner_card_totals p
        where (${full} or exists (select 1 from stg_commanders c where c.commander_id = p.commander_id))
          and not exists (select 1 from stg_totals n where n.commander_id = p.commander_id and n.card_id = p.card_id)
        returning 1
      )
      select count(*)::int as n from gone
    `;
    const [written] = await db<{ n: number }[]>`
      with changed as (
        insert into public.partner_card_totals as p (commander_id, card_id, decks_with, too_early)
        select commander_id, card_id, decks_with, too_early from stg_totals
        on conflict (commander_id, card_id) do update set decks_with = excluded.decks_with, too_early = excluded.too_early
        where (p.decks_with, p.too_early) is distinct from (excluded.decks_with, excluded.too_early)
        returning 1
      )
      select count(*)::int as n from changed
    `;
    await db`commit`;
    return { staged, written: written?.n ?? 0, removed: removed?.n ?? 0 };
  } catch (err) {
    await db`rollback`.catch(() => {});
    throw err;
  }
}

export interface ScoresResult {
  status: 'succeeded' | 'failed_sanity';
  rows: number;
}

/**
 * commander_card_scores and partner_card_totals from the per-key stats (T055). With `commanderIds`, only the commanders
 * and pairs involving them (the per-commander pass after their decks changed); without, every one, and rows of
 * commanders that no longer have decks go. Rows are written only where they moved.
 */
export async function precomputeScores({
  commanderIds,
  force = false,
  sql: given,
}: { commanderIds?: readonly number[]; force?: boolean; sql?: Sql } = {}): Promise<ScoresResult> {
  const sql = given ?? connect();
  const full = commanderIds === undefined;
  const only = full ? null : new Set(commanderIds);
  let runId: number | null = null;
  try {
    const [version] = await sql<{ at: Date | null }[]>`select max(computed_at) as at from public.commander_stats`;
    const start = await startRun(sql, 'precompute_scores', { uri: SCORES_URI, updatedAt: (version?.at ?? new Date(0)).toISOString() }, true);
    if (start.kind === 'skipped') return { status: 'succeeded', rows: 0 };
    runId = start.runId;

    const [settings, keys, baselines, facts, identityMonths] = await Promise.all([
      loadServingSettings(sql),
      loadKeys(sql),
      loadBaselines(sql),
      loadCardFacts(sql),
      loadIdentityMonths(sql),
    ]);
    const keysByCommander = new Map<number, KeyRow[]>();
    for (const k of keys) {
      for (const id of k.commander2 === null ? [k.commander1] : [k.commander1, k.commander2]) {
        keysByCommander.set(id, [...(keysByCommander.get(id) ?? []), k]);
      }
    }
    const sets = commanderSets(keys, only);
    const partners = partnerCommanders(keys, only);
    // Only the keys these commanders' sets can draw on, when the run is for a few commanders.
    const neededKeys = full
      ? undefined
      : [...new Set([...sets.flatMap((s) => [s.commander1, s.commander2]), ...partners].flatMap((id) => (keysByCommander.get(id) ?? []).map((k) => k.id)))];
    const rowsByKey = await loadKeyRows(sql, neededKeys);
    const inputs: Inputs = { settings, keysByCommander, rowsByKey, baselines, facts, identityMonths };

    const rows = sets.reduce((sum, s) => sum + setSize(s, inputs), 0);
    const previousRows = start.previousMetrics?.rows;
    const metrics: SyncMetrics = { full: full ? 1 : 0, commanders: sets.length, rows, partnerCommanders: partners.length };
    if (full && !force && previousRows !== undefined && previousRows > 0 && rows < previousRows * MIN_ROW_SHARE) {
      const error = `sanity gate: ${rows} score rows (previous full run ${previousRows})`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: 0, metrics, error });
      console.error(`precompute_scores: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
      process.exitCode = 1;
      return { status: 'failed_sanity', rows };
    }

    const db = await reserve(sql);
    let written = 0;
    let removed = 0;
    let staged = 0;
    try {
      await db`
        create temp table if not exists stg_scores (
          commander_1 integer not null, commander_2 integer not null, card_id integer not null,
          decks_with double precision not null, commander_decks double precision not null, pool_score double precision not null,
          corpus_value real, weight_scale real
        )
      `;
      await db`
        create temp table if not exists stg_sets (
          commander_1 integer not null, commander_2 integer not null, use_commander boolean, has_sources boolean
        )
      `;
      for (let i = 0; i < sets.length; i += SETS_PER_CHUNK) {
        const result = await mergeChunk(db, sets.slice(i, i + SETS_PER_CHUNK), inputs);
        staged += result.staged;
        written += result.written;
        removed += result.removed;
        await heartbeat(sql, runId, staged);
      }
      if (full) {
        // Commanders with no decks left anywhere have no set any more: their rows go.
        await db`truncate stg_sets`;
        await copyRows(db, 'stg_sets', ['commander_1', 'commander_2'], sets.map((s) => [s.commander1, s.commander2]));
        const [gone] = await db<{ n: number }[]>`
          with gone as (
            delete from public.commander_card_scores s
            where not exists (select 1 from stg_sets t where t.commander_1 = s.commander_1 and t.commander_2 = s.commander_2)
            returning 1
          )
          select count(*)::int as n from gone
        `;
        removed += gone?.n ?? 0;
        await db`
          delete from public.commander_sets s
          where not exists (select 1 from stg_sets t where t.commander_1 = s.commander_1 and t.commander_2 = s.commander_2)
        `;
      }
      const totals = await mergePartnerTotals(db, partners, inputs, full);
      metrics.partnerRows = totals.staged;
      metrics.partnerRowsWritten = totals.written;
      metrics.partnerRowsRemoved = totals.removed;
    } finally {
      db.release();
    }

    metrics.rowsWritten = written;
    metrics.rowsRemoved = removed;
    if (full) {
      await sql`
        insert into public.precompute_state (part, version) values ('scores', ${sql.json({ settings })})
        on conflict (part) do update set version = excluded.version, updated_at = now()
      `;
    }
    await finishRun(sql, runId, 'succeeded', { rowsRead: staged, rowsChanged: written + removed, metrics });
    console.log(
      `precompute_scores: ${sets.length} commanders, ${staged} rows (${written} written, ${removed} removed); ` +
        `partner totals for ${partners.length} commanders`,
    );
    return { status: 'succeeded', rows: staged };
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
    throw err;
  } finally {
    if (!given) await sql.end({ timeout: 5 });
  }
}

/** Key order doesn't survive a round trip through jsonb, so settings are compared with their keys sorted. */
const canonical = (value: unknown) =>
  JSON.stringify(value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);

/** Whether app_config.corpus changed since the last full scores run, which means every score is stale. */
export async function scoreSettingsChanged(sql: Sql): Promise<boolean> {
  const [settings, [state]] = await Promise.all([
    loadServingSettings(sql),
    sql<{ version: { settings?: unknown } }[]>`select version from public.precompute_state where part = 'scores'`,
  ]);
  return canonical(state?.version.settings ?? null) !== canonical(settings);
}
