import type { Result } from "@mtg/core/contract";
import type { AdminDeckCard } from "@/lib/admin/types";
import { getAdminDeckCards } from "@/lib/server/admin";
import { adminErrorResponse, asDeckId, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/decks/{id}/cards
 *
 * One saved deck's cards, commanders first. Separate from the deck list because most decks are never opened, and
 * each read writes its own audit row naming the deck.
 */

const NO_SUCH_DECK = { code: "NOT_FOUND", message: "No such deck." } as const;

export async function GET(request: Request, ctx: RouteContext<"/api/admin/decks/[id]/cards">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asDeckId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_DECK);
  try {
    const cards = await getAdminDeckCards(session.db, id);
    return Response.json({ ok: true, data: cards } satisfies Result<AdminDeckCard[]>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
