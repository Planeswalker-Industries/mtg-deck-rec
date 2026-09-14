import os from 'node:os';
import type { Sql } from './db';

export type SyncJob = 'scryfall_catalog' | 'scryfall_printings' | 'oracle_tags' | 'corpus_aggregate';
export type SyncMetrics = Record<string, number>;

export const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** A running row whose heartbeat is older than this belongs to a worker that died. */
const STALE_AFTER = '15 minutes';

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
  await sql`
    update public.sync_runs
    set status = 'abandoned', finished_at = now(), error = 'heartbeat timed out'
    where job = ${job} and status = 'running' and heartbeat_at < now() - ${STALE_AFTER}::interval
  `;

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
  result: { rowsRead: number; rowsChanged?: number; metrics?: SyncMetrics; error?: string },
): Promise<void> {
  await sql`
    update public.sync_runs
    set status = ${status},
        finished_at = now(),
        heartbeat_at = now(),
        rows_read = ${result.rowsRead},
        rows_changed = ${result.rowsChanged ?? 0},
        metrics = ${result.metrics ? sql.json(result.metrics) : null},
        error = ${result.error ?? null}
    where id = ${runId}
  `;
}
