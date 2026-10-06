import { globalPairs, keyPairs, parsePairSettings, type PairRow, type PairSettings } from '@mtg/core/scoring';
import { reserve, type ReservedSql, type Sql } from '../lib/db';
import { copyRows, loadCardFacts } from '../lib/serving';
import { finishRun, heartbeat, startRun } from '../lib/sync-runs';

/**
 * Card pairs (T064): `commander_card_pairs` per commander key and `card_pairs` over the whole corpus, counted in memory
 * from corpus.decks with `@mtg/core/scoring` `pairs.ts` and merged diff-only. A key is recounted when its stats moved
 * since the last run (every key with `full`, or when app_config.pairs changed); the corpus's pairs are recounted on the
 * worker's weekly schedule.
 */

/** Keys whose decks are read and merged per transaction. */
const KEYS_PER_CHUNK = 100;
/** Lift moves under this aren't written: the score reads ln(lift) to two places. */
const LIFT_TOLERANCE = 0.001;
/** A global run may hold at most this many times the previous run's rows; more means a broken count. */
const MAX_GROWTH = 2;
const PAIR_COLUMNS = ['commander_1', 'commander_2', 'card_a', 'card_b', 'pair_decks', 'lift'];
const PAIRS_URI = 'postgres:corpus.decks';

async function loadPairSettings(sql: Sql): Promise<PairSettings> {
  const [row] = await sql<{ value: unknown }[]>`select value from public.app_config where key = 'pairs'`;
  return parsePairSettings(row?.value);
}

interface Key {
  commander1: number;
  commander2: number;
}

/** A key's decks: card ids and month, a deck posted on two sites counted once (its first copy by id). */
async function keyDecks(db: ReservedSql, keys: readonly Key[]): Promise<Map<string, { cardIds: number[]; month: string }[]>> {
  const rows = await db<{ c1: number; c2: number; card_ids: number[]; month: string; content_hash: string; source: string }[]>`
    select k.c1, k.c2, d.card_ids, to_char(d.updated_month, 'YYYY-MM') as month, encode(d.content_hash, 'hex') as content_hash, d.source
    from unnest(${keys.map((k) => k.commander1)}::int[], ${keys.map((k) => k.commander2)}::int[]) as k (c1, c2)
    join corpus.decks d on d.commander_card_ids = (case when k.c2 = 0 then array[k.c1] else array[k.c1, k.c2] end)
    order by d.id
  `;
  const decks = new Map<string, { cardIds: number[]; month: string }[]>();
  const firstSource = new Map<string, string>();
  for (const r of rows) {
    const seen = firstSource.get(r.content_hash);
    if (seen === undefined) firstSource.set(r.content_hash, r.source);
    else if (seen !== r.source) continue;
    const key = `${r.c1}:${r.c2}`;
    const list = decks.get(key);
    if (list) list.push({ cardIds: r.card_ids, month: r.month });
    else decks.set(key, [{ cardIds: r.card_ids, month: r.month }]);
  }
  return decks;
}

async function stageTable(db: ReservedSql): Promise<void> {
  await db`
    create temp table if not exists stg_pairs (
      commander_1 integer not null, commander_2 integer not null, card_a integer not null, card_b integer not null,
      pair_decks integer not null, lift real not null
    )
  `;
  await db`create temp table if not exists stg_pair_keys (commander_1 integer not null, commander_2 integer not null)`;
  await db`truncate stg_pairs, stg_pair_keys`;
}

/** Writes the staged keys' pairs: what went is deleted, what is new or moved is written. */
async function mergeKeyPairs(db: ReservedSql): Promise<{ written: number; removed: number }> {
  const [removed] = await db<{ n: number }[]>`
    with gone as (
      delete from public.commander_card_pairs p
      using stg_pair_keys k
      where p.commander_1 = k.commander_1 and p.commander_2 = k.commander_2
        and not exists (
          select 1 from stg_pairs s
          where s.commander_1 = p.commander_1 and s.commander_2 = p.commander_2 and s.card_a = p.card_a and s.card_b = p.card_b
        )
      returning 1
    )
    select count(*)::int as n from gone
  `;
  const [written] = await db<{ n: number }[]>`
    with changed as (
      insert into public.commander_card_pairs as p (commander_1, commander_2, card_a, card_b, pair_decks, lift)
      select commander_1, commander_2, card_a, card_b, pair_decks, lift from stg_pairs
      on conflict (commander_1, commander_2, card_a, card_b) do update set pair_decks = excluded.pair_decks, lift = excluded.lift
      where p.pair_decks <> excluded.pair_decks or abs(p.lift - excluded.lift) > ${LIFT_TOLERANCE}
      returning 1
    )
    select count(*)::int as n from changed
  `;
  return { written: written?.n ?? 0, removed: removed?.n ?? 0 };
}

/**
 * `commander_card_pairs` for the keys whose stats moved since the last run, or every key with `full` or when
 * app_config.pairs changed. Returns how many keys it counted.
 */
export async function precomputePairs(sql: Sql, { full = false, force = false }: { full?: boolean; force?: boolean } = {}): Promise<number> {
  const [settings, [state], keyRows] = await Promise.all([
    loadPairSettings(sql),
    sql<{ version: { statsAt?: string; settings?: unknown } }[]>`select version from public.precompute_state where part = 'pairs'`,
    sql<{ commander_1: number; commander_2: number; computed_at: Date }[]>`
      select k.commander_1, coalesce(k.commander_2, 0) as commander_2, s.computed_at
      from public.commander_keys k
      join public.commander_stats s on s.commander_key_id = k.id
    `,
  ]);
  const statsAt = keyRows.reduce((max, r) => (r.computed_at > max ? r.computed_at : max), new Date(0));
  const settingsMoved = JSON.stringify(state?.version.settings) !== JSON.stringify(settings);
  const everyKey = full || force || settingsMoved || !state?.version.statsAt;
  const since = everyKey ? null : new Date(state?.version.statsAt ?? 0);
  const keys = keyRows.filter((r) => since === null || r.computed_at > since).map((r) => ({ commander1: r.commander_1, commander2: r.commander_2 }));
  if (keys.length === 0 && !everyKey) return 0;

  const start = await startRun(sql, 'precompute_pairs', { uri: PAIRS_URI, updatedAt: statsAt.toISOString() }, true);
  if (start.kind === 'skipped') return 0;
  const facts = await loadCardFacts(sql);
  const releaseMonth = (id: number) => facts.get(id)?.releaseMonth ?? null;
  const db = await reserve(sql);
  let rows = 0;
  let written = 0;
  let removed = 0;
  try {
    for (let i = 0; i < keys.length; i += KEYS_PER_CHUNK) {
      const chunk = keys.slice(i, i + KEYS_PER_CHUNK);
      const decks = await keyDecks(db, chunk);
      await db`begin`;
      try {
        await stageTable(db);
        await copyRows(db, 'stg_pair_keys', ['commander_1', 'commander_2'], chunk.map((k) => [k.commander1, k.commander2]));
        for (const k of chunk) {
          const pairs = keyPairs(decks.get(`${k.commander1}:${k.commander2}`) ?? [], releaseMonth, settings);
          rows += pairs.length;
          await copyRows(db, 'stg_pairs', PAIR_COLUMNS, pairs.map((p) => [k.commander1, k.commander2, p.cardA, p.cardB, p.pairDecks, p.lift]));
        }
        const merged = await mergeKeyPairs(db);
        written += merged.written;
        removed += merged.removed;
        await db`commit`;
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
      await heartbeat(sql, start.runId, i + chunk.length);
    }
    if (everyKey) {
      // Keys that no longer exist lose their pairs.
      const [gone] = await db<{ n: number }[]>`
        with gone as (
          delete from public.commander_card_pairs p
          where not exists (
            select 1 from public.commander_keys k
            where k.commander_1 = p.commander_1 and coalesce(k.commander_2, 0) = p.commander_2
          )
          returning 1
        )
        select count(*)::int as n from gone
      `;
      removed += gone?.n ?? 0;
    }
  } catch (err) {
    await finishRun(sql, start.runId, 'failed', { rowsRead: rows, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  await sql`
    insert into public.precompute_state (part, version)
    values ('pairs', ${sql.json({ statsAt: statsAt.toISOString(), settings } as never)})
    on conflict (part) do update set version = excluded.version, updated_at = now()
  `;
  await finishRun(sql, start.runId, 'succeeded', {
    rowsRead: rows,
    rowsChanged: written + removed,
    metrics: { keys: keys.length, rows, rowsWritten: written, rowsRemoved: removed },
  });
  console.log(`precompute_pairs: ${keys.length} keys, ${rows} pairs (${written} written, ${removed} removed)`);
  return keys.length;
}

/**
 * `card_pairs` over the whole corpus. Refuses a count holding more than MAX_GROWTH times the previous run's rows, or
 * none after a run that had some; `force` lets it through.
 */
export async function precomputeGlobalPairs(sql: Sql, { force = false }: { force?: boolean } = {}): Promise<'succeeded' | 'failed_sanity' | 'skipped'> {
  const [version] = await sql<{ at: Date | null; decks: number }[]>`select max(collated_at) as at, count(*)::int as decks from corpus.decks`;
  const start = await startRun(sql, 'precompute_global_pairs', { uri: PAIRS_URI, updatedAt: (version?.at ?? new Date(0)).toISOString() }, force);
  if (start.kind === 'skipped') return 'skipped';
  try {
    const [settings, facts, deckRows] = await Promise.all([
      loadPairSettings(sql),
      loadCardFacts(sql),
      sql<{ card_ids: number[]; color_identity: number; content_hash: string; source: string }[]>`
        select card_ids, color_identity, encode(content_hash, 'hex') as content_hash, source from corpus.decks order by id
      `,
    ]);
    const firstSource = new Map<string, string>();
    const decks = deckRows.filter((d) => {
      const seen = firstSource.get(d.content_hash);
      if (seen === undefined) firstSource.set(d.content_hash, d.source);
      return seen === undefined || seen === d.source;
    });
    const pairs: PairRow[] = globalPairs(
      decks.map((d) => ({ cardIds: d.card_ids, identity: d.color_identity })),
      (id) => facts.get(id)?.identity ?? 0,
      settings,
    );
    const previous = start.previousMetrics?.rows;
    if (!force && previous !== undefined && (pairs.length > previous * MAX_GROWTH || (previous > 0 && pairs.length === 0))) {
      const error = `sanity gate: ${pairs.length} pairs (previous run ${previous})`;
      await finishRun(sql, start.runId, 'failed_sanity', { rowsRead: pairs.length, metrics: { rows: pairs.length }, error });
      console.error(`precompute_global_pairs: ${error}. card_pairs unchanged; re-run with --force if this is expected.`);
      return 'failed_sanity';
    }

    const db = await reserve(sql);
    let written = 0;
    let removed = 0;
    try {
      await db`begin`;
      await db`
        create temp table if not exists stg_card_pairs (card_a integer not null, card_b integer not null, pair_decks integer not null, lift real not null)
      `;
      await db`truncate stg_card_pairs`;
      await copyRows(db, 'stg_card_pairs', ['card_a', 'card_b', 'pair_decks', 'lift'], pairs.map((p) => [p.cardA, p.cardB, p.pairDecks, p.lift]));
      const [gone] = await db<{ n: number }[]>`
        with gone as (
          delete from public.card_pairs p
          where not exists (select 1 from stg_card_pairs s where s.card_a = p.card_a and s.card_b = p.card_b)
          returning 1
        )
        select count(*)::int as n from gone
      `;
      const [changed] = await db<{ n: number }[]>`
        with changed as (
          insert into public.card_pairs as p (card_a, card_b, pair_decks, lift)
          select card_a, card_b, pair_decks, lift from stg_card_pairs
          on conflict (card_a, card_b) do update set pair_decks = excluded.pair_decks, lift = excluded.lift
          where p.pair_decks <> excluded.pair_decks or abs(p.lift - excluded.lift) > ${LIFT_TOLERANCE}
          returning 1
        )
        select count(*)::int as n from changed
      `;
      await db`commit`;
      written = changed?.n ?? 0;
      removed = gone?.n ?? 0;
    } catch (err) {
      await db`rollback`.catch(() => {});
      throw err;
    } finally {
      db.release();
    }
    await finishRun(sql, start.runId, 'succeeded', {
      rowsRead: decks.length,
      rowsChanged: written + removed,
      metrics: { decks: decks.length, rows: pairs.length, rowsWritten: written, rowsRemoved: removed },
    });
    console.log(`precompute_global_pairs: ${decks.length} decks, ${pairs.length} pairs (${written} written, ${removed} removed)`);
    return 'succeeded';
  } catch (err) {
    await finishRun(sql, start.runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  }
}
