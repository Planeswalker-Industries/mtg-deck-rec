import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { adminCrawledDeckCardsInputSchema } from "@/lib/admin/schemas";
import type { AdminCrawledDeckCard } from "@/lib/admin/types";
import { getAdminCrawledDeckCards } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/crawls/decks?deckId=123
 *
 * One crawled deck's cards, resolved to names. Separate from the list because most rows are never opened: a hundred
 * cards a deck across a page of twenty-five would be the difference between a fast list and a slow one.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const deckId = new URL(request.url).searchParams.get("deckId");
  const input = parseInput(adminCrawledDeckCardsInputSchema, { deckId: deckId === null ? undefined : Number(deckId) });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const cards = await getAdminCrawledDeckCards(session.db, input.data.deckId);
    return Response.json({ ok: true, data: cards } satisfies Result<AdminCrawledDeckCard[]>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
