import os from 'node:os';
import { drainSearchIndexQuietly } from '../jobs/sync-search-index';
import type { Sql } from './db';
import { refreshWebCaches } from './web-app';

export type SyncJob =
  | 'scryfall_catalog'
  | 'scryfall_printings'
  | 'oracle_tags'
  | 'corpus_aggregate'
  | 'corpus_collate'
  | 'edhrec_stats'
  | 'edhrec_pages'
  | 'spellbook_combos'
  | 'precompute_commanders'
  | 'precompute_baseline'
  | 'precompute_scores'
  | 'precompute_substitutes'
  | 'precompute_roles'
  | 'precompute_combos'
  | 'precompute_pairs'
  | 'precompute_global_pairs';
export type SyncMetrics = Record<string, number>;

export const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** A running row whose heartbeat is older than this belongs to a worker that died. */
const STALE_AFTER = '15 minutes';
/**
 * How often this process refreshes the heartbeat of every run it has open, well inside STALE_AFTER, so a long job
 * that reports no progress of its own (the baseline, a slow merge) is not taken for a dead one.
 */
const RUN_HEARTBEAT_MS = 60_000;

/** The runs this process has open, with the connection that opened each. */
const openRuns = new Map<number, Sql>();
let runBeat: NodeJS.Timeout | null = null;

function trackRun(sql: Sql, runId: number): void {
  openRuns.set(runId, sql);
  if (runBeat) return;
  runBeat = setInterval(() => {
    for (const [id, conn] of openRuns) {
      void conn`update public.sync_runs set heartbeat_at = now() where id = ${id} and status = 'running'`.catch(() => {});
    }
  }, RUN_HEARTBEAT_MS);
  // A one-off command exits when its work is done, not when this timer stops.
  runBeat.unref();
}

function untrackRun(runId: number): void {
  openRuns.delete(runId);
  if (openRuns.size === 0 && runBeat) {
    clearInterval(runBeat);
    runBeat = null;
  }
}

/**
 * Closes every run this process still has open, as `abandoned` with `reason`: the worker calls it when it stops before
 * its duties end, so the next worker can start those jobs at once instead of waiting out STALE_AFTER. Uses `sql`, not
 * the run's own connection, which may be busy with the statement that never finished.
 */
export async function abandonOpenRuns(sql: Sql, reason: string): Promise<number> {
  const ids = [...openRuns.keys()];
  if (ids.length === 0) return 0;
  const closed = await sql<{ id: string; job: string }[]>`
    update public.sync_runs
    set status = 'abandoned', finished_at = now(), heartbeat_at = now(), error = ${reason}
    where id = any(${ids}::bigint[]) and status = 'running'
    returning id, job
  `;
  for (const id of ids) untrackRun(id);
  for (const run of closed) console.warn(`${run.job}: run ${run.id} closed as abandoned (${reason})`);
  return closed.length;
}

export interface RunSource {
  uri: string;
  updatedAt: string;
}

export type StartResult =
  | { kind: 'started'; runId: number; previousMetrics: SyncMetrics | null }
  | { kind: 'skipped' };

/**
 * Opens a sync run. Marks runs with stale heartbeats as abandoned, skips when the source hasn't changed
 * since the last successful run (unless forced), and refuses to start while another run of the job is live.
 */
export async function startRun(sql: Sql, job: SyncJob, source: RunSource, force: boolean): Promise<StartResult> {
  const stale = await sql<{ id: string }[]>`
    update public.sync_runs
    set status = 'abandoned', finished_at = now(), error = 'heartbeat timed out'
    where job = ${job} and status = 'running' and heartbeat_at < now() - ${STALE_AFTER}::interval
    returning id
  `;
  for (const run of stale) console.warn(`${job}: run ${run.id} closed as abandoned (no heartbeat for ${STALE_AFTER})`);

  const [last] = await sql<{ source_updated_at: Date | null; metrics: SyncMetrics | null }[]>`
    select source_updated_at, metrics
    from public.sync_runs
    where job = ${job} and status = 'succeeded'
    order by started_at desc
    limit 1
  `;

  if (!force && last?.source_updated_at && last.source_updated_at.getTime() === new Date(source.updatedAt).getTime()) {
    await sql`
      insert into public.sync_runs (job, status, source_uri, source_updated_at, worker_id, finished_at)
      values (${job}, 'skipped_unchanged', ${source.uri}, ${source.updatedAt}, ${WORKER_ID}, now())
    `;
    return { kind: 'skipped' };
  }

  try {
    const [run] = await sql<{ id: string }[]>`
      insert into public.sync_runs (job, source_uri, source_updated_at, worker_id)
      values (${job}, ${source.uri}, ${source.updatedAt}, ${WORKER_ID})
      returning id
    `;
    if (!run) throw new Error('sync_runs insert returned no row');
    trackRun(sql, Number(run.id));
    return { kind: 'started', runId: Number(run.id), previousMetrics: last?.metrics ?? null };
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new Error(`Another ${job} run is already in progress.`);
    throw err;
  }
}

export async function heartbeat(sql: Sql, runId: number, rowsRead: number): Promise<void> {
  await sql`update public.sync_runs set heartbeat_at = now(), rows_read = ${rowsRead} where id = ${runId}`;
}

export async function finishRun(
  sql: Sql,
  runId: number,
  status: 'succeeded' | 'failed' | 'failed_sanity',
  result: { rowsRead: number; rowsChanged?: number; metrics?: SyncMetrics; error?: string; summary?: string },
): Promise<void> {
  untrackRun(runId);
  const [run] = await sql<{ job: SyncJob }[]>`
    update public.sync_runs
    set status = ${status},
        finished_at = now(),
        heartbeat_at = now(),
        rows_read = ${result.rowsRead},
        rows_changed = ${result.rowsChanged ?? 0},
        metrics = ${result.metrics ? sql.json(result.metrics) : null},
        error = ${result.error ?? null}
    where id = ${runId}
    returning job
  `;
  // The job's own line comes first: the index update and the cache refresh below can take minutes.
  if (result.summary) console.log(result.summary);
  // Jobs report success only after their transaction commits, so the index and the web app both see the new data.
  // The index goes first: refreshing a page cache that then reads a stale index would be the wrong order.
  if (status === 'succeeded' && run) {
    await drainSearchIndexQuietly(sql, run.job);
    await refreshWebCaches(run.job);
  }
}
