import { setTimeout as sleep } from 'node:timers/promises';
import {
  DEFAULT_CRAWL_RESUME_MINUTES,
  DEFAULT_CRAWL_RESUMES_PER_DAY,
  DEFAULT_CRAWL_RUN_MINUTES,
  DEFAULT_CRAWL_STALE_CLAIM_SECONDS,
  shouldStartCrawl,
  type CrawlDay,
  type CrawlRunState,
} from '@mtg/core/crawl';
import { connect, type Sql } from '../lib/db';
import { abandonOpenRuns } from '../lib/sync-runs';
import { collate } from './collate';
import { checkIn, serveLookups, triggerCrawl } from './lookups';
import { precomputeBaseline, precomputeCommanders } from './precompute-commanders';
import { precomputeGlobalPairs, precomputePairs } from './precompute-pairs';
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
  globalPairsEveryDays: number;
  retryHours: number;
  /** After a failed crawl run, wait this long before starting another with what is left of the day. */
  crawlResumeMinutes: number;
  /** Follow a failed crawl run with another at most this many times a day. */
  crawlResumesPerDay: number;
}

const DEFAULT_SCHEDULE: Schedule = {
  pollSeconds: 5,
  // 3 AM EST (owner, 2026-11-23): the 6-hour run ends before the working day, when merges redeploy the crawl host.
  crawlHourUtc: 8,
  crawlSources: ['archidekt'],
  collateEveryMinutes: 30,
  baselineHourUtc: 4,
  edhrecEveryDays: 7,
  globalPairsEveryDays: 7,
  retryHours: 6,
  crawlResumeMinutes: DEFAULT_CRAWL_RESUME_MINUTES,
  crawlResumesPerDay: DEFAULT_CRAWL_RESUMES_PER_DAY,
};
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;
/** The deck tool calls the collector offline after 30 s without a heartbeat; this keeps well inside that. */
const HEARTBEAT_MS = 10_000;
/** How often the daily crawl trigger may ask the search API again after it couldn't start a run. */
const CRAWL_RETRY_MINUTES = 10;
/**
 * How long one pass may spend rebuilding substitute lists before the worker gets back to lookups. A build of every
 * card's list takes hours on the hosted database (three and a half on 2026-11-18, before migration 20261118000100 cut
 * each list's time by about 40%) and spreads over many passes this way.
 */
const SUBSTITUTES_BUDGET_MS = 2 * MS_PER_MINUTE;
/**
 * How long a stop waits for the duty in hand before closing its runs and exiting. Docker kills the container 60 s
 * after SIGTERM (stop_grace_period in deploy/dokploy/worker.yml and deploy/worker/), so this leaves time to close them.
 */
const SHUTDOWN_DEADLINE_MS = 45_000;
const SHUTDOWN_REASON = 'stopped when the worker shut down';
/** Exit code when the deadline ends a duty early, or a duty is stuck, so the stop shows as unclean. */
const EXIT_INTERRUPTED = 1;
/**
 * How long a duty the loop waits on may run before the worker counts it stuck and restarts. On hosted, the longest that
 * finished in the 30 days to 2026-11-20 was a card pairs pass at 11 min (commander stats 8 min 40 s, scores 7 min 15 s),
 * while a stuck card pairs pass held the loop for 7 h 38 min. Nearly three times the longest leaves room for a bigger
 * corpus. EDHREC and the corpus's card pairs run beside the loop and are not held to it.
 */
const STUCK_AFTER_MS = 30 * MS_PER_MINUTE;
/**
 * How long closing the open runs may take before the process exits anyway, so a database that stopped answering can't
 * keep it alive. Added to SHUTDOWN_DEADLINE_MS it stays inside Docker's 60 s stop grace period.
 */
const CLOSE_RUNS_TIMEOUT_MS = 10_000;

/** The duty the loop is waiting on, and since when; null between duties. */
let inHand: { name: string; since: number } | null = null;

/** Closes this process's open runs as abandoned with `reason`, then exits as unclean; Docker restarts the worker. */
function abandonAndExit(sql: Sql, reason: string): void {
  setTimeout(() => process.exit(EXIT_INTERRUPTED), CLOSE_RUNS_TIMEOUT_MS).unref();
  void abandonOpenRuns(sql, reason)
    .catch((err: unknown) => console.error('worker: closing the open runs failed:', err))
    .finally(() => process.exit(EXIT_INTERRUPTED));
}

async function loadSchedule(sql: Sql): Promise<Schedule> {
  const [row] = await sql<{ value: Partial<Schedule> }[]>`select value from public.app_config where key = 'worker'`;
  return { ...DEFAULT_SCHEDULE, ...row?.value };
}

/** Starts each source's daily crawl once its hour has come, and resumes a failed one with what is left of the day. */
async function dailyCrawls(sql: Sql, schedule: Schedule): Promise<void> {
  if (new Date().getUTCHours() < schedule.crawlHourUtc) return;
  for (const source of schedule.crawlSources) {
    // Today's runs (UTC) that held the claim, as crawl_used_today counts them: an 'already running' row crawled nothing.
    const [row] = await sql<
      {
        disabled: boolean;
        claim_held: boolean;
        used_seconds: number;
        budget_seconds: number;
        newest_state: CrawlRunState | null;
        newest_finished_at: Date | null;
        newest_throttled: boolean | null;
        failed_today: number;
      }[]
    >`
      with policy as (
        select coalesce((value ->> 'runMinutes')::int, ${DEFAULT_CRAWL_RUN_MINUTES}) * ${SECONDS_PER_MINUTE} as budget_seconds,
               coalesce((value ->> 'staleClaimSeconds')::int, ${DEFAULT_CRAWL_STALE_CLAIM_SECONDS}) as stale_seconds
        from (select (select value from public.app_config where key = ${source}) as value) v
      ),
      today as (
        select id, state, started_at, finished_at, error from crawl.runs
        where source = ${source}
          and started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
          and error is distinct from 'already running'
      )
      select coalesce((select disabled from crawl.state where source = ${source}), true) as disabled,
             exists (
               select 1 from crawl.state s, policy p
               where s.source = ${source} and s.running_run_id is not null
                 and s.claimed_at > now() - make_interval(secs => p.stale_seconds)
             ) as claim_held,
             public.crawl_used_today(${source}) as used_seconds,
             (select budget_seconds from policy) as budget_seconds,
             (select state from today order by started_at desc, id desc limit 1) as newest_state,
             (select finished_at from today order by started_at desc, id desc limit 1) as newest_finished_at,
             (select error like 'throttled: %' from today order by started_at desc, id desc limit 1) as newest_throttled,
             (select count(*)::int from today where state = 'failed') as failed_today
    `;
    if (!row) continue;
    const day: CrawlDay = {
      disabled: row.disabled,
      claimHeld: row.claim_held,
      usedSeconds: row.used_seconds,
      newest:
        row.newest_state === null
          ? null
          : { state: row.newest_state, finishedAt: row.newest_finished_at, throttled: row.newest_throttled ?? false },
      failedToday: row.failed_today,
    };
    const start = shouldStartCrawl(
      day,
      {
        crawlHourUtc: schedule.crawlHourUtc,
        budgetSeconds: row.budget_seconds,
        resumeAfterMinutes: schedule.crawlResumeMinutes,
        resumesPerDay: schedule.crawlResumesPerDay,
      },
      new Date(),
    );
    if (start) await triggerCrawl(source, CRAWL_RETRY_MINUTES);
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

/** Whether the corpus's card pairs are due: none succeeded within `globalPairsEveryDays`, none started within `retryHours`. */
async function globalPairsDue(sql: Sql, schedule: Schedule): Promise<boolean> {
  const [row] = await sql<{ due: boolean }[]>`
    select not exists (
             select 1 from public.sync_runs
             where job = 'precompute_global_pairs' and status = 'succeeded'
               and started_at > now() - make_interval(days => ${schedule.globalPairsEveryDays})
           )
       and not exists (
             select 1 from public.sync_runs
             where job = 'precompute_global_pairs' and started_at > now() - make_interval(hours => ${schedule.retryHours})
           ) as due
  `;
  return row?.due ?? false;
}

/** "0.4 s", "12.0 s", "7 min 46 s". */
function elapsed(since: number): string {
  const ms = Date.now() - since;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
  return `${Math.floor(ms / MS_PER_MINUTE)} min ${Math.round((ms % MS_PER_MINUTE) / MS_PER_SECOND)} s`;
}

/**
 * Runs one duty, logging a failure instead of letting it stop the others. An announced duty (the rebuilds, which take
 * seconds to hours) logs when it starts and how long it took; the ones every pass runs (check-in, lookups, the crawl
 * trigger) stay quiet unless they fail. A duty the loop waits on is recorded as the one in hand, so the heartbeat can
 * tell a stuck one; a background duty (EDHREC, the corpus's card pairs) is not.
 */
async function duty(
  name: string,
  run: () => Promise<unknown>,
  { announce = false, background = false }: { announce?: boolean; background?: boolean } = {},
): Promise<void> {
  const started = Date.now();
  if (!background) inHand = { name, since: started };
  if (announce) console.log(`worker: ${name} started`);
  try {
    await run();
    if (announce) console.log(`worker: ${name} done in ${elapsed(started)}`);
  } catch (err) {
    console.error(`worker: ${name} failed after ${elapsed(started)}:`, err);
  } finally {
    if (!background) inHand = null;
  }
}

/** Whether a duty is due; a check that fails (a setting or table this database lacks yet) counts as not due. */
async function due(name: string, check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch (err) {
    console.error(`worker: checking whether ${name} is due failed:`, err);
    return false;
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
 * - the card pairs (T064) of keys whose stats moved, after each collation, and the corpus's every `globalPairsEveryDays`;
 * - an EDHREC fetch every `edhrecEveryDays`, in the background, since it takes hours and lookups must not wait on it;
 *   the corpus's card pairs run in the background too, since the count holds the loop for minutes.
 *
 * When something last ran is read from sync_runs and crawl.runs, so a restart neither repeats nor skips work. A stop
 * signal ends the loop after the duty in hand; an EDHREC fetch stopped halfway keeps the pages it wrote and is retried
 * after `retryHours`. A duty in hand past STUCK_AFTER_MS ends the process the same way, so Docker restarts it.
 */
export async function serve({ once = false }: { once?: boolean } = {}): Promise<void> {
  const sql = connect();
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log('worker: stopping after the duty in hand');
    // A duty that outlasts the deadline is cut off, but its runs are closed first, so the next worker need not wait
    // out the stale-heartbeat window before it can start those jobs again.
    setTimeout(() => {
      console.warn(
        `worker: the duty in hand is still running after ${SHUTDOWN_DEADLINE_MS / MS_PER_SECOND} s; closing its runs and exiting`,
      );
      abandonAndExit(sql, SHUTDOWN_REASON);
    }, SHUTDOWN_DEADLINE_MS).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  // Long duties (a rebuild takes minutes) must not make the collector look offline, but a stuck one must: past
  // STUCK_AFTER_MS the worker stops checking in, closes its runs and exits, and Docker starts it again.
  const heartbeat = setInterval(() => {
    if (inHand && Date.now() - inHand.since > STUCK_AFTER_MS) {
      clearInterval(heartbeat);
      console.error(`worker: ${inHand.name} is stuck after ${elapsed(inHand.since)}; closing its runs and restarting`);
      abandonAndExit(sql, `stuck: ${inHand.name} ran past ${STUCK_AFTER_MS / MS_PER_MINUTE} min`);
      return;
    }
    void checkIn(sql).catch(() => {});
  }, HEARTBEAT_MS);
  let edhrec: Promise<void> | null = null;
  let globalPairs: Promise<void> | null = null;
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
        await duty('collation', () => collate(), { announce: true });
        await duty('commander stats', () => precomputeCommanders(sql), { announce: true });
      }
      if (await due('the nightly baseline', () => baselineDue(sql, schedule)))
        await duty('nightly baseline', () => precomputeBaseline(sql), { announce: true });
      if (await due('scores', () => scoreSettingsChanged(sql))) await duty('scores', () => precomputeScores({ sql }), { announce: true });
      if (collating || substitutesPending) {
        await duty(
          'substitutes',
          async () => {
            substitutesPending = (await precomputeSubstitutes(sql, { budgetMs: SUBSTITUTES_BUDGET_MS })).remaining > 0;
          },
          { announce: true },
        );
      }
      if (collating) {
        await duty('card roles', () => precomputeRoles(sql), { announce: true });
        await duty('combo pieces', () => precomputeCombos(sql), { announce: true });
        await duty('card pairs', () => precomputePairs(sql), { announce: true });
      }
      if (!globalPairs && (await due('corpus card pairs', () => globalPairsDue(sql, schedule)))) {
        globalPairs = duty('corpus card pairs', () => precomputeGlobalPairs(sql, { rerun: true }), {
          announce: true,
          background: true,
        }).finally(() => {
          globalPairs = null;
        });
        if (once) await globalPairs;
      }
      if (!edhrec && !once && (await due('the EDHREC fetch', () => edhrecDue(sql, schedule)))) {
        edhrec = duty('EDHREC fetch', () => syncEdhrec(), { announce: true, background: true }).finally(() => {
          edhrec = null;
        });
      }
      if (once) break;
      await sleep(schedule.pollSeconds * MS_PER_SECOND);
    }
  } finally {
    // The corpus's pair count finishes its transaction well inside the stop grace period; an EDHREC fetch keeps its pages.
    if (globalPairs) await globalPairs;
    // An EDHREC fetch still under way keeps the pages it wrote; its run is closed here and retried after retryHours.
    await abandonOpenRuns(sql, SHUTDOWN_REASON).catch((err: unknown) => console.error('worker: closing the open runs failed:', err));
    clearInterval(heartbeat);
    await sql.end({ timeout: 5 });
  }
}
