import { SearchClient } from '@mtg/core/search';

/**
 * The write side of the search index.
 *
 * The worker holds the admin key; the web app only ever gets a search-only key. Both are environment variables, never
 * code — the repo is public.
 */
export function searchClient(): SearchClient | null {
  const url = process.env.TYPESENSE_URL;
  const apiKey = process.env.TYPESENSE_ADMIN_KEY;
  if (!url || !apiKey) return null;
  // Writes are bulk imports over a network the sync has already finished its transaction on: patient, not urgent.
  return new SearchClient({ url, apiKey, timeoutMs: 30_000 });
}

export function requireSearchClient(): SearchClient {
  const client = searchClient();
  if (!client) {
    throw new Error('TYPESENSE_URL and TYPESENSE_ADMIN_KEY are not set, so there is no search index to write to.');
  }
  return client;
}
