/**
 * When the VPS worker starts a source's crawl (apps/worker/src/jobs/serve.ts `dailyCrawls`). The crawl's allowance is
 * the day's (UTC) total, shared by every run that day (supabase/migrations/20261127000400_crawl_daily_budget.sql): a
 * run that failed or was stopped is followed by another with what is left, a few times a day at most.
 */

/** The day's allowance when app_config.<source> has no runMinutes: the crawl's own fallback (policy.go fallbackRunDuration). */
export const DEFAULT_CRAWL_RUN_MINUTES = 360;
/** How long a claim stays live without app_config.<source>.staleClaimSeconds: the crawl's own fallback (policy.go fallbackStaleClaim). */
export const DEFAULT_CRAWL_STALE_CLAIM_SECONDS = 8 * 60 * 60;
/** A failed run's process may still be closing its rows, or the source may be briefly down: wait before trying again. */
export const DEFAULT_CRAWL_RESUME_MINUTES = 10;
/** Three resumes: a source whose run failed four times in one day has a problem another start won't fix today. */
export const DEFAULT_CRAWL_RESUMES_PER_DAY = 3;

const MS_PER_MINUTE = 60_000;

/** crawl.runs.state. */
export type CrawlRunState = 'queued' | 'running' | 'succeeded' | 'failed';

/** One source's crawl today, as the worker reads it. Only runs that held the claim count ("already running" did not). */
export interface CrawlDay {
  /** The source's kill switch is on (a block); only a human turns it off. */
  disabled: boolean;
  /** A run holds a claim younger than the stale window, so it may still be crawling. A stale claim the crawl takes over. */
  claimHeld: boolean;
  /** Seconds the source crawled today (crawl_used_today). */
  usedSeconds: number;
  /** Today's newest run, or null when none ran today. */
  newest: { state: CrawlRunState; finishedAt: Date | null } | null;
  /** How many of today's runs failed. */
  failedToday: number;
}

export interface CrawlSchedule {
  /** The first hour (UTC) the day's crawl may start. */
  crawlHourUtc: number;
  /** The day's allowance in seconds (app_config.<source>.runMinutes). */
  budgetSeconds: number;
  /** How long after a failed run ends the next may start. */
  resumeAfterMinutes: number;
  /** How many times a day a failed run is followed by another. */
  resumesPerDay: number;
}

/**
 * Whether to start the source's crawl now. Once the hour has come, with the source on and no live claim: the day's
 * first run, or a resume after today's newest run failed, when time is left, it ended at least `resumeAfterMinutes`
 * ago, and fewer than `resumesPerDay` resumes happened (each failed run before the newest was followed by one).
 *
 * A run whose process was killed outright (no SIGTERM) never closes its row, so the newest run stays open and nothing
 * resumes it the same day; the next day's first run takes its stale claim over. A stop or redeploy closes the row.
 */
export function shouldStartCrawl(day: CrawlDay, schedule: CrawlSchedule, now: Date): boolean {
  if (now.getUTCHours() < schedule.crawlHourUtc) return false;
  if (day.disabled || day.claimHeld) return false;
  if (day.newest === null) return true;
  if (day.newest.state !== 'failed' || day.newest.finishedAt === null) return false;
  if (day.usedSeconds >= schedule.budgetSeconds) return false;
  if (now.getTime() - day.newest.finishedAt.getTime() < schedule.resumeAfterMinutes * MS_PER_MINUTE) return false;
  return day.failedToday <= schedule.resumesPerDay;
}
