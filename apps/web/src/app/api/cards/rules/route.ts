import type { CardRules, Result } from "@mtg/core/contract";
import { cardRulesInputSchema, parseInput } from "@mtg/core/schemas";
import { fetchCardRules } from "@/lib/server/card-rules";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/**
 * POST /api/cards/rules: rules text and printed stats for the cards a journey step has on screen, so the card panel
 * can show a card in full without a tap. A POST like /api/cards/tags, since a step's ids do not belong in a URL; the
 * answer is the same for everyone, so it is still safe to cache at the edge.
 */
export async function POST(request: Request): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "search", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const input = parseInput(cardRulesInputSchema, await request.json().catch(() => null));
  if (!input.ok) return errorResponse(input.error);

  try {
    const data = await fetchCardRules(db, input.data.cardIds);
    return Response.json({ ok: true, data } satisfies Result<CardRules[]>, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load these cards' rules text. Try again in a moment." });
  }
}
