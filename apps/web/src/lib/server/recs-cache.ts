import type { CollectionCopies } from "@mtg/core/collection";
import type { RecContext, SwapResult } from "@mtg/core/contract";
import { ownedOnly, rankSwaps, type SwapPool } from "@mtg/core/scoring";
import { cacheLife, cacheTag } from "next/cache";
import { loadCardPage, type CardPageData } from "./card-page";
import { loadCommanderPage, type CommanderPage } from "./commander-page";
import { type FeaturedCommander, loadFeaturedCommanders } from "./featured";
import { availabilityFor } from "./collection-availability";
import { DEFAULT_SWAP_LIMIT, getSwapSuggestions, loadOwnedBoost, loadSwapPool, NotFoundError, SHARED_SWAP_POOL } from "./recs";
import { loadScoringConfig } from "./scoring-config";
import { createPublicClient, type PublicClient } from "./supabase";

/**
 * The deck-independent part of a swap (candidates, card data, tags, play rates), cached per target card, commander(s)
 * and Game Changer setting. It changes only when the catalog, tags or corpus are rebuilt (tag "recs").
 */
async function sharedSwapPool(targetCardId: number, commanderIds: number[], includeGameChangers: boolean): Promise<SwapPool | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("recs", `swap:${targetCardId}`);
  return loadSwapPool(createPublicClient(), {
    targetCardId,
    commanderIds,
    includeGameChangers,
    excludeIds: [],
    ownedIds: null,
    poolSize: SHARED_SWAP_POOL,
  });
}

/** Public card page data. It changes when the catalog, tags or deck corpus are rebuilt. */
export async function getCardPage(slug: string): Promise<CardPageData | null> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog", "corpus", `card:${slug}`);
  return loadCardPage(createPublicClient(), slug);
}

/** Every card and commander page slug, for the sitemap. */
export async function getSitemapSlugs(): Promise<{ cards: string[]; commanders: string[] }> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog", "corpus");
  const { data, error } = await createPublicClient().rpc("sitemap_slugs");
  if (error) throw new Error(`Loading sitemap slugs failed: ${error.message}`);
  const value = (data ?? {}) as { cards?: unknown; commanders?: unknown };
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : []);
  return { cards: strings(value.cards), commanders: strings(value.commanders) };
}

/** Public commander page data. It only changes when the deck corpus is rebuilt (tag "corpus"). */
export async function getCommanderPage(slug: string): Promise<CommanderPage | null> {
  "use cache";
  cacheLife("days");
  cacheTag("corpus", `commander:${slug}`);
  return loadCommanderPage(createPublicClient(), slug);
}

const cachedOpenPool = (_db: PublicClient, targetCardId: number, commanderIds: readonly number[], includeGameChangers: boolean) =>
  sharedSwapPool(targetCardId, [...new Set<number>(commanderIds)].sort((a, b) => a - b), includeGameChangers);

/**
 * Swap suggestions for the swap route. Collection-less requests share the cached pool and only rank it for this deck.
 * 'only' mode reads the user's own pool uncached, with the cached one beside it for the buy list. Kept apart from
 * recs.ts so scripts can run the recommendation code outside Next.js.
 */
export async function getCachedSwapSuggestions(
  db: PublicClient,
  { context, collection, targetCardId, limit }: { context: RecContext; collection: CollectionCopies | null; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  // 'only' mode narrows the pool to the user's cards; 'first' ranks the same pool everyone gets, so it shares the cache.
  if (collection && ownedOnly(context)) {
    return getSwapSuggestions(db, { context, collection, targetCardId, ...(limit === undefined ? {} : { limit }), buyPool: cachedOpenPool });
  }
  const [pool, ownedBoost, scoring, available] = await Promise.all([
    cachedOpenPool(db, targetCardId, context.deck.commanders, context.includeGameChangers),
    loadOwnedBoost(db, context),
    loadScoringConfig(),
    availabilityFor(db, collection),
  ]);
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  return rankSwaps(pool, { context, limit: limit ?? DEFAULT_SWAP_LIMIT, ownedBoost, scoring, availability: available });
}

/**
 * Featured commanders for the landing page carousel. The fixture always returns; the database only adds art,
 * color identity and deck counts. Creating the client is itself guarded so a missing or unreachable
 * configuration still renders the section (CI has no catalog).
 */
export async function getFeaturedCommanders(): Promise<FeaturedCommander[]> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog", "corpus");
  let db: PublicClient | null = null;
  try {
    db = createPublicClient();
  } catch {
    db = null;
  }
  return loadFeaturedCommanders(db);
}
