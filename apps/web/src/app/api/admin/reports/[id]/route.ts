import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { updateAdminFeedbackReportInputSchema } from "@/lib/admin/schemas";
import { setAdminFeedbackReportResolved } from "@/lib/server/admin";
import { adminErrorResponse, asRunId, beginAdminRequest } from "@/lib/server/admin-route";

const NO_SUCH_REPORT = { code: "NOT_FOUND", message: "No such report." } as const;

/** PATCH /api/admin/reports/:id with {resolved}: marks one report resolved, or open again. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/reports/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(updateAdminFeedbackReportInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  // Report ids are positive integers, like sync run ids.
  const id = asRunId((await ctx.params).id);
  if (id === null) return adminErrorResponse(NO_SUCH_REPORT);
  try {
    await setAdminFeedbackReportResolved(session.db, id, input.data.resolved);
    return Response.json({ ok: true, data: null } satisfies Result<null>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
