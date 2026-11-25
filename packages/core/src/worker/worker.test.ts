import { describe, expect, it } from 'vitest';
import { crawlDuty, crawlDutySource, nextDailyRun, nextIntervalRun, nextWorkerRuns, WORKER_DUTIES, WORKER_REQUEST_DUTY } from './index';

const NOW = Date.parse('2026-11-25T12:00:00Z');

describe('nextDailyRun', () => {
  it('waits for the hour when nothing started today', () => {
    expect(nextDailyRun(14, '2026-11-24T14:00:00Z', NOW)).toEqual({ kind: 'at', at: '2026-11-25T14:00:00.000Z' });
  });
  it('is due once the hour has passed without a start today', () => {
    expect(nextDailyRun(8, '2026-11-24T08:00:00Z', NOW)).toEqual({ kind: 'due' });
    expect(nextDailyRun(8, null, NOW)).toEqual({ kind: 'due' });
  });
  it('moves to tomorrow once a run started today, by hand or on time', () => {
    expect(nextDailyRun(8, '2026-11-25T08:00:05Z', NOW)).toEqual({ kind: 'at', at: '2026-11-26T08:00:00.000Z' });
    expect(nextDailyRun(14, '2026-11-25T01:00:00Z', NOW)).toEqual({ kind: 'at', at: '2026-11-26T14:00:00.000Z' });
  });
});

describe('nextIntervalRun', () => {
  it('runs every few days after the last success', () => {
    expect(nextIntervalRun(7, 6, '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z', NOW)).toEqual({
      kind: 'at',
      at: '2026-11-27T00:00:00.000Z',
    });
  });
  it('waits out the retry window after a failed start', () => {
    expect(nextIntervalRun(7, 6, '2026-11-01T00:00:00Z', '2026-11-25T10:00:00Z', NOW)).toEqual({
      kind: 'at',
      at: '2026-11-25T16:00:00.000Z',
    });
  });
  it('is due when it never ran', () => {
    expect(nextIntervalRun(7, 6, null, null, NOW)).toEqual({ kind: 'due' });
  });
});

describe('nextWorkerRuns', () => {
  it('fills missing settings with the defaults and switches off crawls outside the schedule', () => {
    const runs = nextWorkerRuns(
      {
        schedule: { crawlHourUtc: 14 },
        jobs: {},
        crawls: { archidekt: { disabled: false, lastStartedAt: null }, moxfield: { disabled: false, lastStartedAt: null } },
      },
      NOW,
    );
    expect(runs.crawls.archidekt).toEqual({ kind: 'at', at: '2026-11-25T14:00:00.000Z' });
    expect(runs.crawls.moxfield).toEqual({ kind: 'off' });
    expect(runs.duties.collate).toEqual({ kind: 'every', minutes: 30 });
    expect(runs.duties.scores).toEqual({ kind: 'onChange' });
    expect(runs.duties.edhrec).toEqual({ kind: 'due' });
  });
  it('switches off a disabled source', () => {
    const runs = nextWorkerRuns({ schedule: {}, jobs: {}, crawls: { archidekt: { disabled: true, lastStartedAt: null } } }, NOW);
    expect(runs.crawls.archidekt).toEqual({ kind: 'off' });
  });
});

describe('duties', () => {
  it('names a crawl source as a duty and back', () => {
    expect(crawlDuty('archidekt')).toBe('crawl:archidekt');
    expect(crawlDutySource('crawl:archidekt')).toBe('archidekt');
    expect(crawlDutySource('collate')).toBeNull();
  });
  it('accepts every duty and refuses anything else, as the table does', () => {
    for (const duty of [...WORKER_DUTIES, crawlDuty('archidekt')]) expect(WORKER_REQUEST_DUTY.test(duty), duty).toBe(true);
    for (const duty of ['', 'crawl:', 'Collate', 'collate; drop table', 'crawl:Archidekt'])
      expect(WORKER_REQUEST_DUTY.test(duty), duty).toBe(false);
  });
});
