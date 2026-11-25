import type { Result } from "@mtg/core/contract";
import type { AdminUserCollection } from "@/lib/admin/types";
import { getAdminUserCollection } from "@/lib/server/admin";
import { adminErrorResponse, asUserId, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/users/{id}/collection
 *
 * One account's collection totals, value and import history; never its entries (those come through a search, at
 * `./items`). Each call writes one audit row, so the user page asks only when its Collection tab is opened.
 */

const NO_SUCH_USER = { code: "NOT_FOUND", message: "No such user." } as const;

export async function GET(request: Request, ctx: RouteContext<"/api/admin/users/[id]/collection">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);
  try {
    const collection = await getAdminUserCollection(session.db, id);
    return Response.json({ ok: true, data: collection } satisfies Result<AdminUserCollection>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
