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
 *
 * Every response carries `x-search-source`, naming which backend answered (see SearchSource). It is the only way to
 * tell from outside: the search index falls back to Postgres silently on purpose, so both produce the same results.
 *
 * `&fresh=1` answers `no-store` instead. The hour of CDN caching is what keeps a keystroke-debounced search off the
 * database, so it stays — but while that cache is serving, the function never runs and `x-search-source` is whatever
 * was true when the entry was written. This is the escape hatch for checking what is true *now*. It cannot be used to
 * hammer anything: the rate limit below runs before it.
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

  const fresh = params.get("fresh") === "1";
  try {
    const { cards, source } = await searchCards(db, input.data);
    return Response.json({ ok: true, data: cards } satisfies Result<CardSummary[]>, {
      headers: {
        "Cache-Control": fresh ? "no-store" : "public, s-maxage=3600, stale-while-revalidate=86400",
        "x-search-source": source,
      },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't search cards. Try again in a moment." });
  }
}
