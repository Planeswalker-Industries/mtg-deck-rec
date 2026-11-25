import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { updateAdminErrorTicketInputSchema } from "@/lib/admin/schemas";
import type { AdminErrorEvent } from "@/lib/admin/types";
import { getAdminErrorTicketEvents, setAdminErrorTicketResolved } from "@/lib/server/admin";
import { adminErrorResponse, asRunId, beginAdminRequest } from "@/lib/server/admin-route";

const NO_SUCH_TICKET = { code: "NOT_FOUND", message: "No such ticket." } as const;

/** GET /api/admin/errors/:id: every kept event of one ticket, newest first, with its full detail. */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/errors/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  // Ticket ids are positive integers, like sync run ids.
  const id = asRunId((await ctx.params).id);
  if (id === null) return adminErrorResponse(NO_SUCH_TICKET);
  try {
    const events = await getAdminErrorTicketEvents(session.db, id);
    return Response.json({ ok: true, data: events } satisfies Result<AdminErrorEvent[]>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

/** PATCH /api/admin/errors/:id with {resolved}: marks one ticket resolved, or open again. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/errors/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(updateAdminErrorTicketInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  const id = asRunId((await ctx.params).id);
  if (id === null) return adminErrorResponse(NO_SUCH_TICKET);
  try {
    await setAdminErrorTicketResolved(session.db, id, input.data.resolved);
    return Response.json({ ok: true, data: null } satisfies Result<null>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
