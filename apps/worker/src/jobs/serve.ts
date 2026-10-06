import { setTimeout as sleep } from 'node:timers/promises';
import { connect, type Sql } from '../lib/db';
import { collate } from './collate';
import { checkIn, serveLookups, triggerCrawl } from './lookups';
import { precomputeBaseline, precomputeCommanders } from './precompute-commanders';
import { precomputeScores, scoreSettingsChanged } from './precompute-scores';
import { precomputeSubstitutes } from './precompute-substitutes';
import { precomputeCombos, precomputeRoles } from './precompute-tables';
import { syncEdhrec } from './sync-edhrec';

/** app_config.worker; every value has a default, so a missing key never stops the worker. */
interface Schedule {
  pollSeconds: number;
  crawlHourUtc: number;
  crawlSources: string[];
  collateEveryMinutes: number;
  baselineHourUtc: number;
  edhrecEveryDays: number;
  retryHours: number;
}

const DEFAULT_SCHEDULE: Schedule = {
  pollSeconds: 5,
  crawlHourUtc: 10,
  crawlSources: ['archidekt'],
  collateEveryMinutes: 30,
  baselineHourUtc: 4,
  edhrecEveryDays: 7,
  retryHours: 6,
};
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
/** The deck tool calls the collector offline after 30 s without a heartbeat; this keeps well inside that. */
const HEARTBEAT_MS = 10_000;
/** How often the daily crawl trigger may ask the search API again after it couldn't start a run. */
const CRAWL_RETRY_MINUTES = 10;
/**
 * How long one pass may spend rebuilding substitute lists before the worker gets back to lookups. The first build of
 * every card's list (about 15 minutes) spreads over several passes this way.
 */
const SUBSTITUTES_BUDGET_MS = 2 * MS_PER_MINUTE;

async function loadSchedule(sql: Sql): Promise<Schedule> {
  const [row] = await sql<{ value: Partial<Schedule> }[]>`select value from public.app_config where key = 'worker'`;
  return { ...DEFAULT_SCHEDULE, ...row?.value };
}

/** Starts each source's daily crawl once its hour has come, unless a run already started that day (UTC). */
async function dailyCrawls(sql: Sql, schedule: Schedule): Promise<void> {
  if (new Date().getUTCHours() < schedule.crawlHourUtc) return;
  for (const source of schedule.crawlSources) {
    const [today] = await sql<{ started: boolean; disabled: boolean }[]>`
      select exists (
               select 1 from crawl.runs
               where source = ${source} and started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
             ) as started,
             coalesce((select disabled from crawl.state where source = ${source}), true) as disabled
    `;
    if (today && !today.started && !today.disabled) await triggerCrawl(source, CRAWL_RETRY_MINUTES);
  }
}

/**
 * Whether the nightly baseline is due: its hour has come and no baseline started today (UTC). Every outcome counts as
 * a start, a failed gate included, so a refused baseline isn't retried every pass.
 */
async function baselineDue(sql: Sql, schedule: Schedule): Promise<boolean> {
  if (new Date().getUTCHours() < schedule.baselineHourUtc) return false;
  const [row] = await sql<{ due: boolean }[]>`
    select not exists (
      select 1 from public.sync_runs
      where job = 'precompute_baseline' and started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    ) as due
  `;
  return row?.due ?? false;
}

/** Whether EDHREC is due a fetch: none succeeded within `edhrecEveryDays`, and none started within `retryHours`. */
async function edhrecDue(sql: Sql, schedule: Schedule): Promise<boolean> {
  const [row] = await sql<{ due: boolean }[]>`
    select not exists (
             select 1 from public.sync_runs
             where job = 'edhrec_pages' and status = 'succeeded' and started_at > now() - make_interval(days => ${schedule.edhrecEveryDays})
           )
       and not exists (
             select 1 from public.sync_runs
             where job = 'edhrec_pages' and started_at > now() - make_interval(hours => ${schedule.retryHours})
           ) as due
  `;
  return row?.due ?? false;
}

/** Runs one duty, logging a failure instead of letting it stop the others. */
async function duty(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`worker: ${name} failed:`, err);
  }
}

/**
 * The VPS worker's one long-running process (deploy/worker/, T066). Every `pollSeconds` it serves the deck lookups,
 * then runs whatever app_config.worker says is due:
 *
 * - each source's daily crawl, started through the search API at `crawlHourUtc` (T042);
 * - a collation every `collateEveryMinutes` (a pass with nothing new records nothing), then the precompute worker's
 *   checks (T055): the stats and scores of commanders whose decks changed, substitute lists that are due (a few
 *   minutes at a time, carried on in the next pass), card roles and combo pieces if their inputs moved;
 * - the nightly baseline at `baselineHourUtc`, which ends by re-scoring every commander;
 * - every score again whenever app_config.corpus changes;
 * - an EDHREC fetch every `edhrecEveryDays`, in the background, since it takes hours and lookups must not wait on it.
 *
 * When something last ran is read from sync_runs and crawl.runs, so a restart neither repeats nor skips work. A stop
 * signal ends the loop after the duty in hand; an EDHREC fetch stopped halfway keeps the pages it wrote and is retried
 * after `retryHours`.
 */
export async function serve({ once = false }: { once?: boolean } = {}): Promise<void> {
  const sql = connect();
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('worker: stopping after the duty in hand');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // Long duties (a rebuild takes minutes) must not make the collector look offline.
  const heartbeat = setInterval(() => void checkIn(sql).catch(() => {}), HEARTBEAT_MS);
  let edhrec: Promise<void> | null = null;
  let lastCollate = 0;
  let substitutesPending = false;
  console.log(`worker: serving${once ? ' one pass' : ''}`);

  try {
    while (!stopping) {
      const schedule = await loadSchedule(sql);
      await duty('check-in', () => checkIn(sql));
      await duty('deck lookups', () => serveLookups(sql));
      await duty('daily crawl', () => dailyCrawls(sql, schedule));
      const collating = Date.now() - lastCollate >= schedule.collateEveryMinutes * MS_PER_MINUTE;
      if (collating) {
        lastCollate = Date.now();
        await duty('collation', () => collate());
        await duty('commander stats', () => precomputeCommanders(sql));
      }
      if (await baselineDue(sql, schedule)) await duty('nightly baseline', () => precomputeBaseline(sql));
      if (await scoreSettingsChanged(sql)) await duty('scores', () => precomputeScores({ sql }));
      if (collating || substitutesPending) {
        await duty('substitutes', async () => {
          substitutesPending = (await precomputeSubstitutes(sql, { budgetMs: SUBSTITUTES_BUDGET_MS })).remaining > 0;
        });
      }
      if (collating) {
        await duty('card roles', () => precomputeRoles(sql));
        await duty('combo pieces', () => precomputeCombos(sql));
      }
      if (!edhrec && !once && (await edhrecDue(sql, schedule))) {
        edhrec = duty('EDHREC fetch', () => syncEdhrec()).finally(() => {
          edhrec = null;
        });
      }
      if (once) break;
      await sleep(schedule.pollSeconds * MS_PER_SECOND);
    }
  } finally {
    clearInterval(heartbeat);
    await sql.end({ timeout: 5 });
  }
}
