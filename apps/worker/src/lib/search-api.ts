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
