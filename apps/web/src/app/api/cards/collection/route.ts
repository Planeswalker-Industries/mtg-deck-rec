import type { CollectionCardsResult, Result } from "@mtg/core/contract";
import { collectionCardsInputSchema, parseInput } from "@mtg/core/schemas";
import { loadCollectionCards } from "@/lib/server/collection-cards";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/**
 * POST /api/cards/collection: cards with their tag labels, and set names, for the collection view. A POST because a
 * collection's card ids don't fit in a URL. The answer depends only on the ids asked for, so it can be cached like the
 * tags route.
 */
export async function POST(request: Request): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "collection", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const input = parseInput(collectionCardsInputSchema, await request.json().catch(() => null));
  if (!input.ok) return errorResponse(input.error);

  try {
    const data = await loadCollectionCards(db, input.data.cardIds, input.data.setCodes);
    return Response.json({ ok: true, data } satisfies Result<CollectionCardsResult>, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load your collection's cards. Try again in a moment." });
  }
}
