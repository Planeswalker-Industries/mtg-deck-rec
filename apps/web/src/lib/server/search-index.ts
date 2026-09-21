import { SearchClient, type TagDocument } from "@mtg/core/search";

/**
 * The read side of the search index.
 *
 * Nothing here talks to Typesense. It talks to the search API (services/search-api), which is the only thing that
 * does — so chunking, paging and the search ranking live there rather than being rebuilt at every call site, and
 * the Typesense keys never leave the VPS.
 *
 * Two rules hold everywhere below, and every caller depends on them:
 *
 * 1. **Unconfigured is a normal state.** CI builds against an empty database with mocks, and a fresh checkout has no
 *    search API at all. With `SEARCH_API_URL` unset, `getSearchIndex()` returns null and every read path takes the
 *    Postgres query it always took.
 * 2. **A failure is never an error.** An index we added to make the site faster must not become a new way for it to
 *    break — the same stance as `getHeroArt` returning null when the database is down. `fromIndex` swallows, logs and
 *    hands back null, and the caller falls through to Postgres.
 */

let client: SearchClient | null | undefined;

export function getSearchIndex(): SearchClient | null {
  if (client !== undefined) return client;
  const url = process.env.SEARCH_API_URL;
  const token = process.env.SEARCH_API_TOKEN;
  const timeout = Number(process.env.SEARCH_API_TIMEOUT_MS);
  client = url && token ? new SearchClient({ url, token, ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}) }) : null;
  return client;
}

/** Test seam: `scripts/search-index-check.ts` installs a client without environment variables. */
export function setSearchIndexForTesting(next: SearchClient | null): void {
  client = next;
}

/**
 * Runs a read against the index. Returns `{ value }` on success and **null** when the index is unconfigured, slow or
 * broken — a boxed result, because plenty of these reads legitimately answer with null or an empty list, and
 * "the index says no" must not be confused with "the index didn't answer".
 */
export async function fromIndex<T>(label: string, run: (index: SearchClient) => Promise<T>): Promise<{ value: T } | null> {
  const index = getSearchIndex();
  if (!index) return null;
  try {
    return { value: await run(index) };
  } catch (err) {
    console.warn(`${label}: the search index didn't answer, falling back to the database.`, err);
    return null;
  }
}

/**
 * Every Tagger tag, kept per server instance.
 *
 * It is ~4,500 small documents and it is what turns the tag ids on a card document into labelled TagRefs. The TTL is
 * short because `tags.disabled` is a kill switch that is supposed to take effect at once, and this map is where it is
 * applied (see `tagRefsFromDocument`). Same shape as `pricesCheckedAt` in cards.ts.
 *
 * One request: the search API pages Typesense on its side, so this is a single round trip a minute per instance at
 * worst, against a query per deck grouping otherwise. A failed reload keeps the map it already had rather than
 * dropping tags the app is about to render.
 */
const TAGS_TTL_MS = 60 * 1000;
let tagCache: { tags: Map<string, TagDocument>; loadedAt: number } | null = null;

export async function loadTagDocuments(): Promise<Map<string, TagDocument> | null> {
  if (tagCache && Date.now() - tagCache.loadedAt < TAGS_TTL_MS) return tagCache.tags;
  const loaded = await fromIndex("Tags", async (index) => new Map((await index.allTags()).map((tag) => [tag.id, tag])));
  if (!loaded) return tagCache?.tags ?? null;
  tagCache = { tags: loaded.value, loadedAt: Date.now() };
  return loaded.value;
}

export function clearSearchIndexCachesForTesting(): void {
  tagCache = null;
}
