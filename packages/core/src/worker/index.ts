/**
 * The worker's schedule (`app_config.worker`), shared by the worker that keeps it and the admin home that shows when
 * each duty runs next, and the duties an admin may ask it to run now (`public.worker_requests`).
 */

/** app_config.worker; every value has a default, so a missing key never stops the worker. */
export interface WorkerSchedule {
  pollSeconds: number;
  crawlHourUtc: number;
  crawlSources: string[];
  collateEveryMinutes: number;
  baselineHourUtc: number;
  edhrecEveryDays: number;
  globalPairsEveryDays: number;
  retryHours: number;
}

export const DEFAULT_WORKER_SCHEDULE: WorkerSchedule = {
  pollSeconds: 5,
  // 3 AM EST (owner, 2026-11-23): the 6-hour run ends before the working day, when merges redeploy the crawl host.
  crawlHourUtc: 8,
  crawlSources: ['archidekt'],
  collateEveryMinutes: 30,
  baselineHourUtc: 4,
  edhrecEveryDays: 7,
  globalPairsEveryDays: 7,
  retryHours: 6,
};

/** The worker's own duties an admin can ask for; a crawl source's run is `crawl:<source>` (crawlDuty). */
export const WORKER_DUTIES = ['collate', 'baseline', 'scores', 'global_pairs', 'edhrec'] as const;
export type WorkerDuty = (typeof WORKER_DUTIES)[number];

const CRAWL_DUTY_PREFIX = 'crawl:';
/** Matching worker_requests.duty's check. */
export const WORKER_REQUEST_DUTY = /^(collate|baseline|scores|global_pairs|edhrec|crawl:[a-z]+)$/;

export const crawlDuty = (source: string): string => `${CRAWL_DUTY_PREFIX}${source}`;

/** The source a `crawl:<source>` duty names, or null for any other duty. */
export function crawlDutySource(duty: string): string | null {
  return duty.startsWith(CRAWL_DUTY_PREFIX) ? duty.slice(CRAWL_DUTY_PREFIX.length) : null;
}

/**
 * When a duty runs next on its own: at a time, already due (the worker takes it on its next pass), every few minutes,
 * whenever the scoring settings change, or never (a crawl source switched off or left out of the schedule).
 */
export type NextRun =
  { kind: 'at'; at: string } | { kind: 'due' } | { kind: 'every'; minutes: number } | { kind: 'onChange' } | { kind: 'off' };

/** The facts `admin_worker_schedule()` returns, which the next runs are worked out from. */
export interface WorkerScheduleFacts {
  schedule: Partial<WorkerSchedule>;
  /** By sync job: the newest run's start and the newest successful run's start. */
  jobs: Partial<Record<string, { lastStartedAt: string | null; lastSucceededAt: string | null }>>;
  crawls: Partial<Record<string, { disabled: boolean; lastStartedAt: string | null }>>;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function at(ms: number, now: number): NextRun {
  return ms <= now ? { kind: 'due' } : { kind: 'at', at: new Date(ms).toISOString() };
}

/**
 * A once-a-day duty (the crawl, the baseline): it starts at `hourUtc` unless a run already started that UTC day. As
 * the worker decides it, so a run started by hand earlier in the day counts as the day's.
 */
export function nextDailyRun(hourUtc: number, lastStartedAt: string | null, now: number): NextRun {
  const today = new Date(now);
  const startOfDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const todayAt = startOfDay + hourUtc * MS_PER_HOUR;
  if (lastStartedAt !== null && Date.parse(lastStartedAt) >= startOfDay) return at(todayAt + MS_PER_DAY, now);
  return at(todayAt, now);
}

/**
 * A duty every few days (EDHREC, the corpus's card pairs): due once none succeeded within `everyDays` and none started
 * within `retryHours`, so a failed run is tried again after the retry window.
 */
export function nextIntervalRun(
  everyDays: number,
  retryHours: number,
  lastSucceededAt: string | null,
  lastStartedAt: string | null,
  now: number,
): NextRun {
  const afterSuccess = lastSucceededAt === null ? now : Date.parse(lastSucceededAt) + everyDays * MS_PER_DAY;
  const afterStart = lastStartedAt === null ? now : Date.parse(lastStartedAt) + retryHours * MS_PER_HOUR;
  return at(Math.max(afterSuccess, afterStart), now);
}

/** When each worker duty, and each crawl source, runs next on its own. */
export function nextWorkerRuns(
  facts: WorkerScheduleFacts,
  now: number,
): { duties: Record<WorkerDuty, NextRun>; crawls: Record<string, NextRun> } {
  const schedule = { ...DEFAULT_WORKER_SCHEDULE, ...facts.schedule };
  const job = (name: string) => facts.jobs[name] ?? { lastStartedAt: null, lastSucceededAt: null };
  const crawls: Record<string, NextRun> = {};
  for (const [source, crawl] of Object.entries(facts.crawls)) {
    if (!crawl) continue;
    crawls[source] =
      crawl.disabled || !schedule.crawlSources.includes(source)
        ? { kind: 'off' }
        : nextDailyRun(schedule.crawlHourUtc, crawl.lastStartedAt, now);
  }
  return {
    duties: {
      // The worker counts the half hour from its own last pass, which a restart resets: "every 30 min" is the honest
      // answer, not a time.
      collate: { kind: 'every', minutes: schedule.collateEveryMinutes },
      baseline: nextDailyRun(schedule.baselineHourUtc, job('precompute_baseline').lastStartedAt, now),
      scores: { kind: 'onChange' },
      global_pairs: nextIntervalRun(
        schedule.globalPairsEveryDays,
        schedule.retryHours,
        job('precompute_global_pairs').lastSucceededAt,
        job('precompute_global_pairs').lastStartedAt,
        now,
      ),
      edhrec: nextIntervalRun(
        schedule.edhrecEveryDays,
        schedule.retryHours,
        job('edhrec_pages').lastSucceededAt,
        job('edhrec_pages').lastStartedAt,
        now,
      ),
    },
    crawls,
  };
}
