import { SearchClient } from '@mtg/core/search';

/**
 * The write side of the search index.
 *
 * The worker talks to the search API (services/search-api), never to Typesense: only that service holds Typesense's
 * key, and it is the only thing that can reach it. The admin token here is what separates the worker from the web
 * app, whose token can read and nothing else.
 *
 * Both are environment variables, never code — the repo is public.
 */
export function searchClient(): SearchClient | null {
  const url = process.env.SEARCH_API_URL;
  const token = process.env.SEARCH_API_ADMIN_TOKEN;
  if (!url || !token) return null;
  // Writes are bulk imports over a network the sync has already finished its transaction on: patient, not urgent.
  return new SearchClient({ url, token, timeoutMs: 30_000 });
}

export function requireSearchClient(): SearchClient {
  const client = searchClient();
  if (!client) {
    throw new Error('SEARCH_API_URL and SEARCH_API_ADMIN_TOKEN are not set, so there is no search index to write to.');
  }
  return client;
}

/** The scrape answers within its 10 s preflight; this leaves room for a slow network. */
const CRAWL_TRIGGER_TIMEOUT_MS = 30_000;

/** What the search API says when asked to crawl: started, or not (another run holds the source's claim). */
export interface CrawlTrigger {
  started: boolean;
  reason?: string;
}

/**
 * Starts a source's deck crawl through the search API (`POST /cron/:source/scrape`), the same call the daily Vercel
 * cron makes. The cron token can start a scrape and nothing else; the admin token can too. An empty variable counts as
 * unset, because compose files pass an unset variable through as ''. Null when neither is configured.
 */
export async function startCrawl(source: string): Promise<CrawlTrigger | null> {
  const url = process.env.SEARCH_API_URL;
  const token = process.env.SEARCH_API_CRON_TOKEN || process.env.SEARCH_API_ADMIN_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(`${url.replace(/\/$/, '')}/cron/${encodeURIComponent(source)}/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(CRAWL_TRIGGER_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<CrawlTrigger> & { error?: string };
  if (!res.ok) throw new Error(`the search API answered ${res.status} to a ${source} crawl: ${body.error ?? 'no detail'}`);
  return { started: body.started === true, ...(body.reason ? { reason: body.reason } : {}) };
}
