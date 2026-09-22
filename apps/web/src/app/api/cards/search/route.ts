import type { CardSummary, Result } from "@mtg/core/contract";
import { parseInput, searchCardsInputSchema } from "@mtg/core/schemas";
import { searchCards } from "@/lib/server/card-search";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/**
 * GET /api/cards/search?q=liesa&commander=1&limit=8: card names for pickers. The deckbuilder adds colors=WB, type=land,
 * mv=3 and offset, and may leave q empty to browse. Results are the same for everyone, so the CDN keeps them.
 */
export async function GET(request: Request): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "search", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const params = new URL(request.url).searchParams;
  const limit = params.get("limit");
  const number = (key: string) => {
    const value = params.get(key);
    return value === null || value === "" ? {} : { [key === "mv" ? "manaValue" : key]: Number(value) };
  };
  const colors = params.get("colors");
  const type = params.get("type");
  const input = parseInput(searchCardsInputSchema, {
    q: params.get("q") ?? "",
    commanderEligible: params.get("commander") === "1",
    ...(limit ? { limit: Number(limit) } : {}),
    ...(colors !== null ? { colorIdentity: colors } : {}),
    ...(type ? { cardType: type } : {}),
    ...number("mv"),
    ...number("offset"),
  });
  if (!input.ok) return errorResponse(input.error);

  try {
    const data = await searchCards(db, input.data);
    return Response.json({ ok: true, data } satisfies Result<CardSummary[]>, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't search cards. Try again in a moment." });
  }
}
