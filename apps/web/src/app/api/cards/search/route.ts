import type { CardSearchInput, CardSummary, Result } from "@mtg/core/contract";
import { parseInput, searchCardsInputSchema } from "@mtg/core/schemas";
import { searchCards, type CardSearchQuery } from "@/lib/server/card-search";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { accountOwnedIds, errorResponse } from "@/lib/server/recs-route";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/** Public searches are the same for everyone, so the CDN keeps them for an hour and serves stale for a day. */
const PUBLIC_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

/**
 * GET /api/cards/search?q=liesa&commander=1&limit=8: card names for pickers. The deckbuilder adds colors=WB,
 * type=legendary,creature (every type), mv=2,4 (any cost), sort=name_asc and offset, and may leave q empty to browse.
 * Results are the same for everyone, so the CDN keeps them.
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
  const params = new URL(request.url).searchParams;
  const limit = params.get("limit");
  const offset = params.get("offset");
  const sort = params.get("sort");
  /** A comma-separated parameter as a list; absent or empty is no list. */
  const list = (key: string) => (params.get(key) ?? "").split(",").filter((part) => part !== "");
  const colors = params.get("colors");
  const types = list("type");
  const manaValues = list("mv");
  return respond(
    request,
    {
      q: params.get("q") ?? "",
      commanderEligible: params.get("commander") === "1",
      ...(limit ? { limit: Number(limit) } : {}),
      ...(colors !== null ? { colorIdentity: colors } : {}),
      ...(types.length > 0 ? { cardTypes: types } : {}),
      ...(manaValues.length > 0 ? { manaValues: manaValues.map(Number) } : {}),
      ...(offset ? { offset: Number(offset) } : {}),
      ...(sort ? { sort } : {}),
    },
    params.get("fresh") === "1" ? "no-store" : PUBLIC_CACHE,
  );
}

/**
 * POST /api/cards/search: the same search limited to a collection (`ownedOnly`). A browser collection travels in the
 * body, which a URL can't hold, and an account one is read for whoever is signed in, so the answer is private and
 * never cached.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ code: "VALIDATION", message: "The search wasn't valid JSON." });
  }
  return respond(request, body, "private, no-store");
}

async function respond(request: Request, raw: unknown, cacheControl: string): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "search", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const input = parseInput(searchCardsInputSchema, raw);
  if (!input.ok) return errorResponse(input.error);

  try {
    const query = await withOwnedIds(input.data);
    if (!query) return errorResponse({ code: "UNAUTHENTICATED", message: "Sign in to search your saved collection." });
    const { cards, source } = await searchCards(db, query);
    return Response.json({ ok: true, data: cards } satisfies Result<CardSummary[]>, {
      headers: { "Cache-Control": cacheControl, "x-search-source": source },
    });
  } catch (err) {
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: "Couldn't search cards. Try again in a moment." });
  }
}

/** The search with its collection as card ids; null when it asks for an account collection and nobody is signed in. */
async function withOwnedIds({ ownedOnly, ...rest }: CardSearchInput): Promise<CardSearchQuery | null> {
  if (ownedOnly === undefined) return rest;
  const ownedCardIds = ownedOnly.kind === "session" ? ownedOnly.ownedCardIds : await accountOwnedIds();
  return ownedCardIds === null ? null : { ...rest, ownedCardIds };
}
