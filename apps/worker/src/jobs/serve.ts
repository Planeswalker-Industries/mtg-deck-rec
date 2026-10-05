import { setTimeout as sleep } from 'node:timers/promises';
import { connect, type Sql } from '../lib/db';
import { aggregateCorpus } from './aggregate-corpus';
import { checkIn, serveNextRequest } from './serve-commander-requests';
import { syncEdhrec } from './sync-edhrec';

/** What app_config.worker holds; every value has a default so a missing key never stops the worker. */
interface Schedule {
  aggregateEveryHours: number;
  edhrecEveryDays: number;
  crawlHourUtc: number;
  crawlSources: string[];
  pollSeconds: number;
}

const DEFAULT_SCHEDULE: Schedule = { aggregateEveryHours: 6, edhrecEveryDays: 7, crawlHourUtc: 10, crawlSources: ['archidekt'], pollSeconds: 5 };
const MS_PER_SECOND = 1000;
/** The scrape answers within its 10 s preflight; this leaves room for a slow network. */
const CRAWL_TRIGGER_TIMEOUT_MS = 30_000;

async function loadSchedule(sql: Sql): Promise<Schedule> {
  const [row] = await sql<{ value: Partial<Schedule> }[]>`select value from public.app_config where key = 'worker'`;
  return { ...DEFAULT_SCHEDULE, ...row?.value };
}

/**
 * Whether a job last started longer ago than `interval` (a Postgres interval), or never ran. Every outcome counts as an
 * attempt: a rebuild that failed its sanity gate fails the same way until a person acts, so retrying it on every pass
 * would only redo the whole rebuild every few seconds.
 */
async function due(sql: Sql, job: 'corpus_aggregate' | 'edhrec_stats', interval: string): Promise<boolean> {
  const [row] = await sql<{ due: boolean }[]>`
    select not exists (
      select 1 from public.sync_runs where job = ${job} and started_at > now() - ${interval}::interval
    ) as due
  `;
  return row?.due ?? false;
}

/**
 * Starts a source's daily crawl through the search API once its hour has come and no crawl run started today (UTC).
 * Request runs don't count, and neither does a trigger that found the claim taken (a run row closed as "already
 * running"): that one never crawled, so the next pass tries again. The claim makes a second trigger harmless, so this
 * can run beside any other.
 */
async function triggerCrawls(sql: Sql, schedule: Schedule): Promise<void> {
  const url = process.env.SEARCH_API_URL;
  // The cron token can start a scrape and read its status, nothing else; the admin token also works, and the worker
  // already holds it for the search index.
  const token = process.env.SEARCH_API_CRON_TOKEN ?? process.env.SEARCH_API_ADMIN_TOKEN;
  if (!url || !token || new Date().getUTCHours() < schedule.crawlHourUtc) return;
  for (const source of schedule.crawlSources) {
    const [today] = await sql<{ started: boolean }[]>`
      select exists (
        select 1 from corpus.crawl_runs
        where source = ${source} and kind = 'crawl' and error is distinct from 'already running'
          and started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      ) as started
    `;
    if (today?.started) continue;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/cron/${source}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(CRAWL_TRIGGER_TIMEOUT_MS),
      });
      console.log(`crawl ${source}: the search API answered ${res.status} ${await res.text()}`);
    } catch (err) {
      console.warn(`crawl ${source}: could not reach the search API: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * The VPS worker's one long-running process (deploy/worker/). Every `pollSeconds` it checks in, serves the oldest deck
 * lookup if Archidekt is free, and then runs whatever app_config.worker says is due:
 *
 * - the daily Archidekt crawl, started through the search API at `crawlHourUtc`;
 * - a corpus rebuild every `aggregateEveryHours` (skipped while corpus.decks is unchanged);
 * - an EDHREC refresh every `edhrecEveryDays`, in the background, since it takes hours and lookups must not wait on it.
 *
 * "Due" is read from sync_runs and crawl_runs, not kept in memory, so a restart neither repeats nor skips work.
 */
export async function serveWorker({ once = false }: { once?: boolean } = {}): Promise<void> {
  const sql = connect();
  let edhrec: Promise<unknown> | null = null;
  console.log(`worker: serving${once ? ' one pass' : ' (Ctrl+C to stop)'}`);
  try {
    for (;;) {
      const schedule = await loadSchedule(sql);
      await checkIn(sql);
      try {
        const served = await serveNextRequest(sql);
        if (served === 'served') continue;

        await triggerCrawls(sql, schedule);
        if (await due(sql, 'corpus_aggregate', `${schedule.aggregateEveryHours} hours`)) await aggregateCorpus();
        if (!edhrec && (await due(sql, 'edhrec_stats', `${schedule.edhrecEveryDays} days`))) {
          edhrec = syncEdhrec()
            .catch((err: unknown) => console.error('edhrec_stats failed:', err))
            .finally(() => {
              edhrec = null;
            });
          if (once) await edhrec;
        }
      } catch (err) {
        // One failed duty must not stop the others: log it and try again on the next pass.
        console.error('worker: a scheduled duty failed:', err);
      }
      if (once) return;
      await sleep(schedule.pollSeconds * MS_PER_SECOND);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
