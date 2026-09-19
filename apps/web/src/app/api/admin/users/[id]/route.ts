import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { updateAdminUserInputSchema } from "@/lib/admin/schemas";
import type { AdminUser } from "@/lib/admin/types";
import { deleteAdminUser, getAdminUser, updateAdminUser } from "@/lib/server/admin";
import { adminErrorResponse, asUserId, beginAdminRequest } from "@/lib/server/admin-route";

/** One account: read it, change it, or delete it. All three answer with the account as it stands afterwards. */

const NO_SUCH_USER = { code: "NOT_FOUND", message: "No such user." } as const;

export async function GET(request: Request, ctx: RouteContext<"/api/admin/users/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);
  try {
    const user = await getAdminUser(session.db, id);
    if (!user) return adminErrorResponse(NO_SUCH_USER);
    return Response.json({ ok: true, data: user } satisfies Result<AdminUser>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/users/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(updateAdminUserInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);
  try {
    await updateAdminUser(session.db, id, input.data);
    const user = await getAdminUser(session.db, id);
    if (!user) return adminErrorResponse(NO_SUCH_USER);
    return Response.json({ ok: true, data: user } satisfies Result<AdminUser>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/users/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);
  try {
    // Read first: once the account is gone there is nothing left to answer with, and React Admin wants the record
    // it just removed so it can offer an undo-shaped confirmation.
    const user = await getAdminUser(session.db, id);
    if (!user) return adminErrorResponse(NO_SUCH_USER);
    await deleteAdminUser(session.db, id);
    return Response.json({ ok: true, data: user } satisfies Result<AdminUser>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
