import { reserve, type Sql } from '../lib/db';
import { copyRows } from '../lib/serving';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/**
 * card_substitutes (T055): each card's substitutes, computed by precompute_substitutes (rec_swap_candidates'
 * similarity over every card, the first `substitutesDepth` inside every colour identity that can hold the card) and
 * written only where a list changed.
 *
 * A card is rebuilt when it is new, when what its similarity rests on moved (its functional tags and their idf, its
 * colours, mana value and functional twin, the depth, the functional tag config: `tags_hash`), when a tag near its own
 * was switched on or off, and every `substitutesRebuildDays`, which is what catches a list that changed through its
 * candidates rather than through the card itself.
 */

/** Cards whose lists are computed and merged together. */
const BATCH_TARGETS = 64;
/** The depth when app_config.precompute has none: the shared swap pool's (migration 20261006000100 says why). */
const DEFAULT_DEPTHS = { substitutesDepth: 220 };
const DEFAULT_REBUILD_DAYS = 7;
/**
 * A first batch where more than this share of the cards that had substitutes come back with none stops the run: that
 * is a broken tag config or hierarchy, not a week of tag edits.
 */
const MAX_EMPTIED_SHARE = 0.5;
/** Below this many cards that had substitutes, a first batch is too small to judge. */
const MIN_JUDGED_TARGETS = 20;
const SUBSTITUTES_URI = 'postgres:public.card_tags';
const MS_PER_DAY = 86_400_000;

interface Depths {
  substitutesDepth: number;
}

async function loadDepths(sql: Sql): Promise<{ depths: Depths; rebuildDays: number }> {
  const [precompute, worker] = await Promise.all([
    sql<{ value: Partial<Depths> }[]>`select value from public.app_config where key = 'precompute'`,
    sql<{ value: { substitutesRebuildDays?: number } }[]>`select value from public.app_config where key = 'worker'`,
  ]);
  return {
    depths: { ...DEFAULT_DEPTHS, ...precompute[0]?.value },
    rebuildDays: worker[0]?.value.substitutesRebuildDays ?? DEFAULT_REBUILD_DAYS,
  };
}

/**
 * Every live card's hash of what its list rests on. The functional tag config goes in too, so changing the roots, the
 * deny list or the exclusive groups rebuilds every list.
 */
async function currentHashes(sql: Sql, depths: Depths): Promise<Map<number, string>> {
  const rows = await sql<{ card_id: number; tags_hash: string }[]>`
    with config as (
      select md5(coalesce(string_agg(key || '=' || value::text, ';' order by key), '')) as hash
      from public.app_config
      where key in ('functional_tag_roots', 'functional_tag_denied_roots', 'functional_tag_exclusive_groups')
    ),
    tagged as (
      select ct.card_id, string_agg(ct.tag_id::text || ':' || round(t.idf::numeric, 4)::text, ',' order by ct.tag_id) as tags
      from public.card_tags ct
      join public.functional_tags f on f.tag_id = ct.tag_id
      join public.tags t on t.id = ct.tag_id
      group by ct.card_id
    )
    select c.id as card_id,
           md5(concat_ws('|', 'by-identity', ${depths.substitutesDepth}::int, (select hash from config),
                         c.color_identity, c.mana_value, c.equivalence_base_id, coalesce(g.tags, ''))) as tags_hash
    from public.cards c
    left join tagged g on g.card_id = c.id
    where c.deleted_at is null
  `;
  return new Map(rows.map((r) => [r.card_id, r.tags_hash]));
}

/**
 * Tags switched on or off since the last pass make the lists of cards near them stale, through their candidates: the
 * cards carrying any tag within two steps of a common ancestor of a flipped one. Their hashes are cleared, so they
 * are rebuilt even if this pass runs out of time, and the new kill-switch state is stored.
 */
async function markFlipped(sql: Sql): Promise<number> {
  const [now] = await sql<{ disabled: string[] }[]>`
    select coalesce(array_agg(id::text order by id), '{}') as disabled from public.tags where disabled or deleted_at is not null
  `;
  const disabled = now?.disabled ?? [];
  const [state] = await sql<{ version: { disabled?: string[] } }[]>`select version from public.precompute_state where part = 'substitutes'`;
  const before = state?.version.disabled;
  let marked = 0;
  if (before) {
    const was = new Set(before);
    const is = new Set(disabled);
    const flipped = [...disabled.filter((id) => !was.has(id)), ...before.filter((id) => !is.has(id))];
    if (flipped.length > 0) {
      const result = await sql`
        with up as (
          select tc.ancestor_id as id from public.tag_closure tc where tc.descendant_id = any (${flipped}::uuid[]) and tc.depth <= 2
        ),
        near as (
          select tc.descendant_id as id from public.tag_closure tc join up on up.id = tc.ancestor_id where tc.depth <= 2
        )
        update public.substitute_targets s set tags_hash = ''
        where s.card_id in (select ct.card_id from public.card_tags ct join near n on n.id = ct.tag_id)
          and s.tags_hash <> ''
      `;
      marked = result.count;
    }
  }
  await sql`
    insert into public.precompute_state (part, version) values ('substitutes', ${sql.json({ disabled })})
    on conflict (part) do update set version = excluded.version, updated_at = now()
  `;
  return marked;
}

export interface SubstitutesResult {
  status: 'succeeded' | 'failed_sanity' | 'nothing_to_do';
  done: number;
  remaining: number;
}

/**
 * Rebuilds the lists that are due, newest reason first: new cards and changed ones, then the oldest lists. `full`
 * rebuilds every list; `budgetMs` stops after the batch that crosses it, so the worker's other duties don't wait an
 * hour on the first build. What isn't done is picked up by the next pass.
 */
export async function precomputeSubstitutes(
  sql: Sql,
  { full = false, force = false, budgetMs }: { full?: boolean; force?: boolean; budgetMs?: number } = {},
): Promise<SubstitutesResult> {
  const started = Date.now();
  const { depths, rebuildDays } = await loadDepths(sql);
  const flipped = await markFlipped(sql);
  const hashes = await currentHashes(sql, depths);
  const stored = await sql<{ card_id: number; tags_hash: string; built_at: Date }[]>`
    select card_id, tags_hash, built_at from public.substitute_targets
  `;
  const storedById = new Map(stored.map((s) => [s.card_id, s]));
  const staleBefore = Date.now() - rebuildDays * MS_PER_DAY;

  const changed: number[] = [];
  const aged: { id: number; builtAt: number }[] = [];
  for (const [id, hash] of hashes) {
    const s = storedById.get(id);
    if (full || !s || s.tags_hash !== hash) changed.push(id);
    else if (s.built_at.getTime() < staleBefore) aged.push({ id, builtAt: s.built_at.getTime() });
  }
  const gone = stored.filter((s) => !hashes.has(s.card_id)).map((s) => s.card_id);
  const due = [...changed, ...aged.sort((a, b) => a.builtAt - b.builtAt).map((a) => a.id)];
  if (due.length === 0 && gone.length === 0) return { status: 'nothing_to_do', done: 0, remaining: 0 };

  const start = await startRun(sql, 'precompute_substitutes', { uri: SUBSTITUTES_URI, updatedAt: new Date().toISOString() }, true);
  if (start.kind === 'skipped') return { status: 'nothing_to_do', done: 0, remaining: due.length };
  const runId = start.runId;
  const metrics: SyncMetrics = { due: due.length, flipped, gone: gone.length, targets: 0, rows: 0, rowsWritten: 0, rowsRemoved: 0 };

  try {
    if (gone.length > 0) {
      // Cards that left the catalog: their lists go (substitutes of theirs are filtered out when read).
      await sql`delete from public.card_substitutes where card_id = any (${gone}::int[])`;
      await sql`delete from public.substitute_targets where card_id = any (${gone}::int[])`;
    }

    let done = 0;
    for (let i = 0; i < due.length; i += BATCH_TARGETS) {
      if (budgetMs !== undefined && Date.now() - started > budgetMs) break;
      const batch = due.slice(i, i + BATCH_TARGETS);
      const lists = await Promise.all(
        batch.map((id) =>
          sql<{ card_id: number; tag_similarity: number; is_functional_twin: boolean }[]>`
            select card_id, tag_similarity, is_functional_twin
            from public.precompute_substitutes(${id}, ${depths.substitutesDepth})
          `.then((rows) => ({ id, rows })),
        ),
      );

      if (i === 0 && !force && !full) {
        const had = await sql<{ card_id: number }[]>`
          select distinct card_id from public.card_substitutes where card_id = any (${batch}::int[])
        `;
        const emptied = lists.filter((l) => l.rows.length === 0 && had.some((h) => h.card_id === l.id)).length;
        if (had.length >= MIN_JUDGED_TARGETS && emptied > had.length * MAX_EMPTIED_SHARE) {
          const error = `sanity gate: ${emptied} of ${had.length} cards lost every substitute`;
          await finishRun(sql, runId, 'failed_sanity', { rowsRead: 0, metrics, error });
          console.error(`precompute_substitutes: ${error}. Lists unchanged; check the functional tag config, or re-run with --force.`);
          process.exitCode = 1;
          return { status: 'failed_sanity', done: 0, remaining: due.length };
        }
      }

      const db = await reserve(sql);
      try {
        await db`
          create temp table if not exists stg_substitutes (
            card_id integer not null, substitute_id integer not null, tag_similarity real not null, is_functional_twin boolean not null
          )
        `;
        await db`create temp table if not exists stg_targets (card_id integer primary key, tags_hash text not null)`;
        await db`truncate stg_substitutes, stg_targets`;
        const staged = await copyRows(
          db,
          'stg_substitutes',
          ['card_id', 'substitute_id', 'tag_similarity', 'is_functional_twin'],
          lists.flatMap((l) => l.rows.map((r) => [l.id, r.card_id, r.tag_similarity, r.is_functional_twin])),
        );
        await copyRows(db, 'stg_targets', ['card_id', 'tags_hash'], batch.map((id) => [id, hashes.get(id) ?? '']));
        await db`begin`;
        try {
          const [removed] = await db<{ n: number }[]>`
            with gone as (
              delete from public.card_substitutes s
              using stg_targets t
              where s.card_id = t.card_id
                and not exists (select 1 from stg_substitutes n where n.card_id = s.card_id and n.substitute_id = s.substitute_id)
              returning 1
            )
            select count(*)::int as n from gone
          `;
          const [written] = await db<{ n: number }[]>`
            with changed as (
              insert into public.card_substitutes as s (card_id, substitute_id, tag_similarity, is_functional_twin)
              select card_id, substitute_id, tag_similarity, is_functional_twin from stg_substitutes
              on conflict (card_id, substitute_id) do update set
                tag_similarity = excluded.tag_similarity,
                is_functional_twin = excluded.is_functional_twin
              where (s.tag_similarity, s.is_functional_twin) is distinct from (excluded.tag_similarity, excluded.is_functional_twin)
              returning 1
            )
            select count(*)::int as n from changed
          `;
          await db`
            insert into public.substitute_targets as s (card_id, tags_hash, built_at)
            select card_id, tags_hash, now() from stg_targets
            on conflict (card_id) do update set tags_hash = excluded.tags_hash, built_at = excluded.built_at
          `;
          await db`commit`;
          metrics.rows = (metrics.rows ?? 0) + staged;
          metrics.rowsWritten = (metrics.rowsWritten ?? 0) + (written?.n ?? 0);
          metrics.rowsRemoved = (metrics.rowsRemoved ?? 0) + (removed?.n ?? 0);
        } catch (err) {
          await db`rollback`.catch(() => {});
          throw err;
        }
      } finally {
        db.release();
      }
      done += batch.length;
      metrics.targets = done;
      await heartbeat(sql, runId, done);
    }

    const remaining = due.length - done;
    metrics.remaining = remaining;
    await finishRun(sql, runId, 'succeeded', {
      rowsRead: done,
      rowsChanged: (metrics.rowsWritten ?? 0) + (metrics.rowsRemoved ?? 0),
      metrics,
    });
    console.log(
      `precompute_substitutes: ${done} of ${due.length} cards rebuilt (${metrics.rowsWritten} rows written, ` +
        `${metrics.rowsRemoved} removed)${remaining > 0 ? `; ${remaining} left for the next pass` : ''}`,
    );
    return { status: 'succeeded', done, remaining };
  } catch (err) {
    await finishRun(sql, runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  }
}
