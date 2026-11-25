import type { Result } from "@mtg/core/contract";
import type { AdminUserDeck } from "@/lib/admin/types";
import { getAdminUserDecks } from "@/lib/server/admin";
import { adminErrorResponse, asUserId, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/users/{id}/decks
 *
 * Every deck the account saved, public or private. Each call writes one audit row, so the user page asks only when
 * its Decks tab is opened.
 */

const NO_SUCH_USER = { code: "NOT_FOUND", message: "No such user." } as const;

export async function GET(request: Request, ctx: RouteContext<"/api/admin/users/[id]/decks">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);
  try {
    const decks = await getAdminUserDecks(session.db, id);
    return Response.json({ ok: true, data: decks } satisfies Result<AdminUserDeck[]>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
