import { setTimeout as sleep } from 'node:timers/promises';
import { USER_AGENT } from './config';

/** Spaces requests to one host at least `minIntervalMs` apart, across concurrent callers. */
export class RateLimiter {
  private nextSlot = 0;
  private readonly minIntervalMs: number;

  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
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
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * The only way the worker talks to other services: accurate User-Agent, explicit Accept,
 * request spacing, and exponential backoff (honoring Retry-After) on 429 and 5xx.
 */
export async function politeFetch(
  url: string,
  { limiter, accept = 'application/json;q=0.9,*/*;q=0.8', maxRetries = 5 }: FetchPolicy = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await limiter?.wait();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    if (res.ok) return res;
    await res.body?.cancel();
    if (!RETRYABLE.has(res.status) || attempt >= maxRetries) throw new HttpError(res.status, url);

    const retryAfterSec = Number(res.headers.get('retry-after'));
    const delayMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 2 ** attempt * 1000 + Math.random() * 500;
    await sleep(delayMs);
  }
}
