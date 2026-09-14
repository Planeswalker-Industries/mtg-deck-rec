import { setTimeout as sleep } from 'node:timers/promises';
import { USER_AGENT } from './config';

/** Spaces requests to one host at least `minIntervalMs` apart, across concurrent callers. */
export class RateLimiter {
  private nextSlot = 0;
  private minIntervalMs: number;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  get intervalMs(): number {
    return this.minIntervalMs;
  }

  /** Changes the spacing for later requests, e.g. wider after a service pushes back. */
  setIntervalMs(ms: number): void {
    this.minIntervalMs = ms;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

export interface FetchPolicy {
  limiter?: RateLimiter;
  accept?: string;
  maxRetries?: number;
  /** Statuses retried here with short backoff (default 429 and 5xx). Callers with their own 429 handling pass 5xx only. */
  retryStatuses?: ReadonlySet<number>;
  /** Called before each backoff wait, so callers can report how often a service pushed back. */
  onRetry?: (status: number, delayMs: number) => void;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * The only way the worker talks to other services: accurate User-Agent, explicit Accept,
 * request spacing, and exponential backoff (honoring Retry-After) on 429 and 5xx.
 */
export async function politeFetch(
  url: string,
  { limiter, accept = 'application/json;q=0.9,*/*;q=0.8', maxRetries = 5, retryStatuses = RETRYABLE, onRetry }: FetchPolicy = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await limiter?.wait();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    if (res.ok) return res;
    await res.body?.cancel();
    if (!retryStatuses.has(res.status) || attempt >= maxRetries) throw new HttpError(res.status, url);

    const retryAfterSec = Number(res.headers.get('retry-after'));
    const delayMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 2 ** attempt * 1000 + Math.random() * 500;
    onRetry?.(res.status, delayMs);
    await sleep(delayMs);
  }
}
