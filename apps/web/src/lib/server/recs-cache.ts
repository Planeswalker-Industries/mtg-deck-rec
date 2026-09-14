import type { CommanderPageData, RecContext, SwapResult } from "@mtg/core/contract";
import { cacheLife, cacheTag } from "next/cache";
import { loadCommanderPage } from "./commander-page";
import { getSwapSuggestions, loadSwapPool, NotFoundError, rankSwaps, SHARED_SWAP_POOL, type SwapPool } from "./recs";
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

/** Public commander page data. It only changes when the deck corpus is rebuilt (tag "corpus"). */
export async function getCommanderPage(slug: string): Promise<CommanderPageData | null> {
  "use cache";
  cacheLife("days");
  cacheTag("corpus", `commander:${slug}`);
  return loadCommanderPage(createPublicClient(), slug);
}

/**
 * Swap suggestions for the swap route. Collection-less requests share the cached pool and only rank it for this deck;
 * collection-aware requests depend on the user's cards and skip the cache. Kept apart from recs.ts so scripts can run
 * the recommendation code outside Next.js.
 */
export async function getCachedSwapSuggestions(
  db: PublicClient,
  { context, targetCardId, limit }: { context: RecContext; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  if (context.ownership) return getSwapSuggestions(db, { context, targetCardId, limit });
  const commanderIds = [...new Set<number>(context.deck.commanders)].sort((a, b) => a - b);
  const pool = await sharedSwapPool(targetCardId, commanderIds, context.includeGameChangers);
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  return rankSwaps(pool, { context, limit });
}
