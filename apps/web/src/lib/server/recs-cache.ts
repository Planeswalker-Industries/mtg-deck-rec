import type { RecContext, SwapResult } from "@mtg/core/contract";
import { cacheLife, cacheTag } from "next/cache";
import { loadCardPage, type CardPageData } from "./card-page";
import { loadCommanderPage, type CommanderPage } from "./commander-page";
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
