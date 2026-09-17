import type { CardId, Result, TagRef } from "@mtg/core/contract";
import { cardTagsInputSchema, parseInput } from "@mtg/core/schemas";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";
import { fetchCardTags } from "@/lib/server/card-tags";

/**
 * POST /api/cards/tags: functional tags for a set of cards, so the deck workspace can group a deck by what its
 * cards do. A POST rather than a GET because a 100-card deck's ids do not belong in a URL; the answer is the same
 * for everyone, so it is still safe to cache at the edge.
 */
export async function POST(request: Request): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "search", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const input = parseInput(cardTagsInputSchema, await request.json().catch(() => null));
  if (!input.ok) return errorResponse(input.error);

  try {
    const data = await fetchCardTags(db, input.data.cardIds);
    return Response.json({ ok: true, data } satisfies Result<{ cardId: CardId; tags: TagRef[] }[]>, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load what these cards do. Try again in a moment." });
  }
}
