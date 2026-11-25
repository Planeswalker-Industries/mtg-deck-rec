import { describe, expect, it } from 'vitest';
import { shouldStartCrawl, type CrawlDay, type CrawlSchedule } from './schedule';

const SCHEDULE: CrawlSchedule = { crawlHourUtc: 8, budgetSeconds: 6 * 3600, resumeAfterMinutes: 10, resumesPerDay: 3 };
const NOON = new Date('2026-11-25T12:00:00Z');
const minutesBefore = (date: Date, minutes: number) => new Date(date.getTime() - minutes * 60_000);

const FRESH_DAY: CrawlDay = { disabled: false, claimHeld: false, usedSeconds: 0, newest: null, failedToday: 0 };
/** Today's run failed an hour in, 30 minutes ago. */
const FAILED_ONCE: CrawlDay = {
  ...FRESH_DAY,
  usedSeconds: 3600,
  newest: { state: 'failed', finishedAt: minutesBefore(NOON, 30) },
  failedToday: 1,
};

describe('shouldStartCrawl', () => {
  it('starts the day’s first run once its hour has come', () => {
    expect(shouldStartCrawl(FRESH_DAY, SCHEDULE, NOON)).toBe(true);
    expect(shouldStartCrawl(FRESH_DAY, SCHEDULE, new Date('2026-11-25T07:59:00Z'))).toBe(false);
  });

  it('never starts a disabled source or beside a live claim', () => {
    expect(shouldStartCrawl({ ...FRESH_DAY, disabled: true }, SCHEDULE, NOON)).toBe(false);
    expect(shouldStartCrawl({ ...FRESH_DAY, claimHeld: true }, SCHEDULE, NOON)).toBe(false);
    expect(shouldStartCrawl({ ...FAILED_ONCE, claimHeld: true }, SCHEDULE, NOON)).toBe(false);
  });

  it('resumes a failed run with time left', () => {
    expect(shouldStartCrawl(FAILED_ONCE, SCHEDULE, NOON)).toBe(true);
  });

  it('leaves a day whose run succeeded, or is still open', () => {
    expect(shouldStartCrawl({ ...FAILED_ONCE, newest: { state: 'succeeded', finishedAt: minutesBefore(NOON, 30) } }, SCHEDULE, NOON)).toBe(
      false,
    );
    expect(shouldStartCrawl({ ...FAILED_ONCE, newest: { state: 'running', finishedAt: null } }, SCHEDULE, NOON)).toBe(false);
  });

  it('does not resume once the day’s allowance is spent', () => {
    expect(shouldStartCrawl({ ...FAILED_ONCE, usedSeconds: SCHEDULE.budgetSeconds }, SCHEDULE, NOON)).toBe(false);
  });

  it('waits resumeAfterMinutes after the failure', () => {
    const justFailed: CrawlDay = { ...FAILED_ONCE, newest: { state: 'failed', finishedAt: minutesBefore(NOON, 9) } };
    expect(shouldStartCrawl(justFailed, SCHEDULE, NOON)).toBe(false);
    expect(shouldStartCrawl(justFailed, SCHEDULE, new Date(NOON.getTime() + 60_000))).toBe(true);
  });

  it('stops after resumesPerDay resumes', () => {
    // The third failure was followed by two resumes; a third is allowed, a fourth is not.
    expect(shouldStartCrawl({ ...FAILED_ONCE, failedToday: 3 }, SCHEDULE, NOON)).toBe(true);
    expect(shouldStartCrawl({ ...FAILED_ONCE, failedToday: 4 }, SCHEDULE, NOON)).toBe(false);
  });
});
