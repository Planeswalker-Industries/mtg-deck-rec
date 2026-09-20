import {
  CARDS_COLLECTION,
  COMMANDER_CARDS_COLLECTION,
  MAX_PER_PAGE,
  SearchClient,
  TAGS_COLLECTION,
  type CardDocument,
  type CommanderCardDocument,
  type TagDocument,
} from "@mtg/core/search";

/**
 * The read side of the search index.
 *
 * Two rules hold everywhere below, and every caller depends on them:
 *
 * 1. **Unconfigured is a normal state.** CI builds against an empty database with mocks, and a fresh checkout has no
 *    Typesense at all. With `TYPESENSE_URL` unset, `getSearchIndex()` returns null and every read path takes the
 *    Postgres query it always took.
 * 2. **A failure is never an error.** An index we added to make the site faster must not become a new way for it to
 *    break — the same stance as `getHeroArt` returning null when the database is down. `fromIndex` swallows, logs and
 *    hands back null, and the caller falls through to Postgres.
 */

let client: SearchClient | null | undefined;

export function getSearchIndex(): SearchClient | null {
  if (client !== undefined) return client;
  const url = process.env.TYPESENSE_URL;
  const apiKey = process.env.TYPESENSE_SEARCH_KEY;
  const timeout = Number(process.env.TYPESENSE_TIMEOUT_MS);
  client = url && apiKey ? new SearchClient({ url, apiKey, ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}) }) : null;
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

/** Ids split into pages the search API will accept, sent as one round trip. */
export async function fetchCardDocuments(index: SearchClient, cardIds: readonly number[]): Promise<CardDocument[]> {
  const chunks: number[][] = [];
  for (let i = 0; i < cardIds.length; i += MAX_PER_PAGE) chunks.push(cardIds.slice(i, i + MAX_PER_PAGE));
  const results = await index.multiSearch<CardDocument>(
    chunks.map((chunk) => ({
      collection: CARDS_COLLECTION,
      q: "*",
      filter_by: `card_id:[${chunk.join(",")}]`,
      per_page: MAX_PER_PAGE,
    })),
  );
  return results.flatMap((r) => (r.hits ?? []).map((h) => h.document));
}

export async function fetchCommanderCardDocuments(
  index: SearchClient,
  { keyIds, cardIds }: { keyIds: readonly number[]; cardIds: readonly number[] },
): Promise<CommanderCardDocument[]> {
  if (keyIds.length === 0 || cardIds.length === 0) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < cardIds.length; i += MAX_PER_PAGE) chunks.push(cardIds.slice(i, i + MAX_PER_PAGE));
  const results = await index.multiSearch<CommanderCardDocument>(
    chunks.flatMap((chunk) =>
      keyIds.map((keyId) => ({
        collection: COMMANDER_CARDS_COLLECTION,
        q: "*",
        filter_by: `key_id:=${keyId} && card_id:[${chunk.join(",")}]`,
        per_page: MAX_PER_PAGE,
      })),
    ),
  );
  return results.flatMap((r) => (r.hits ?? []).map((h) => h.document));
}

/**
 * Every Tagger tag, kept per server instance.
 *
 * It is ~4,500 small documents and it is what turns the tag ids on a card document into labelled TagRefs. The TTL is
 * short because `tags.disabled` is a kill switch that is supposed to take effect at once, and this map is where it is
 * applied (see `tagRefsFromDocument`). Same shape as `pricesCheckedAt` in cards.ts.
 *
 * Loading it is ~19 pages, because a search page holds at most 250 documents — a couple of dozen small requests a
 * minute per instance at worst, against a query per deck grouping otherwise. A failed reload keeps the map it
 * already had rather than dropping tags the app is about to render.
 */
const TAGS_TTL_MS = 60 * 1000;
let tagCache: { tags: Map<string, TagDocument>; loadedAt: number } | null = null;

export async function loadTagDocuments(): Promise<Map<string, TagDocument> | null> {
  if (tagCache && Date.now() - tagCache.loadedAt < TAGS_TTL_MS) return tagCache.tags;
  const loaded = await fromIndex("Tags", async (index) => {
    const tags = new Map<string, TagDocument>();
    for (let page = 1; ; page++) {
      const result = await index.search<TagDocument>(TAGS_COLLECTION, { q: "*", per_page: MAX_PER_PAGE, page });
      const hits = result.hits ?? [];
      for (const hit of hits) tags.set(hit.document.id, hit.document);
      if (hits.length < MAX_PER_PAGE || tags.size >= (result.found ?? 0)) break;
    }
    return tags;
  });
  if (!loaded) return tagCache?.tags ?? null;
  tagCache = { tags: loaded.value, loadedAt: Date.now() };
  return loaded.value;
}

export function clearSearchIndexCachesForTesting(): void {
  tagCache = null;
}
