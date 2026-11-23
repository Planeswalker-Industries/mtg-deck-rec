import type { CollectionCopies } from "@mtg/core/collection";
import type { RecContext, SwapResult, UpgradesResult } from "@mtg/core/contract";
import { DEFAULT_UPGRADES_LIMIT, pickUpgrades } from "@mtg/core/shop";
import { getCutSuggestions, NotFoundError } from "./recs";
import { getCachedSwapSuggestions } from "./recs-cache";
import type { PublicClient } from "./supabase";

/** Weakest deck cards scanned for upgrades: 12 concurrent swap reads keep the request near the swap route's latency. */
const UPGRADE_TARGET_SCAN = 12;

/**
 * Upgrades worth buying (T102) for a deck the collection fully supplies: the deck's weakest cards (its cut
 * suggestions), each one's swap buy list in 'only' mode under the context's budget, and the best of those by gain
 * (`pickUpgrades`). Nothing without a collection or with no money left to spend. Its own file because it reads the
 * cached swaps (`recs-cache.ts`), which keeps `next/cache` out of recs.ts.
 */
export async function getUpgrades(
  db: PublicClient,
  { context, collection, limit = DEFAULT_UPGRADES_LIMIT }: { context: RecContext; collection: CollectionCopies | null; limit?: number },
): Promise<UpgradesResult> {
  if (!collection || context.budget?.spendLeftUsd === 0) return { suggestions: [] };
  // The buy list is an 'only' mode list: unowned cards measured against what the collection supplies.
  const only: RecContext = { ...context, ownershipMode: "only" };
  const cuts = await getCutSuggestions(db, { context: only, collection, limit: UPGRADE_TARGET_SCAN });
  const swaps = await Promise.all(
    cuts.suggestions.map((cut) =>
      getCachedSwapSuggestions(db, { context: only, collection, targetCardId: cut.card.id }).catch((err: unknown): SwapResult | null => {
        // A card missing from the catalog has no replacements; anything else fails the request.
        if (err instanceof NotFoundError) return null;
        throw err;
      }),
    ),
  );
  return { suggestions: pickUpgrades(swaps.filter((s): s is SwapResult => s !== null), limit) };
}
