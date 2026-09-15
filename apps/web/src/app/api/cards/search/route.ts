import type { CardSummary, Result } from "@mtg/core/contract";
import { parseInput, searchCardsInputSchema } from "@mtg/core/schemas";
import { searchCards } from "@/lib/server/card-search";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/** GET /api/cards/search?q=liesa&commander=1&limit=8: card names for pickers. Results are the same for everyone, so the CDN keeps them. */
export async function GET(request: Request): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "search", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const params = new URL(request.url).searchParams;
  const limit = params.get("limit");
  const input = parseInput(searchCardsInputSchema, {
    q: params.get("q") ?? "",
    commanderEligible: params.get("commander") === "1",
    ...(limit ? { limit: Number(limit) } : {}),
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
