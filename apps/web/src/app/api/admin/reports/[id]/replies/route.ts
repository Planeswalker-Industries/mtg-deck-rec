import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { replyAdminFeedbackReportInputSchema } from "@/lib/admin/schemas";
import type { AdminFeedbackReply } from "@/lib/admin/types";
import { setAdminFeedbackReportResolved } from "@/lib/server/admin";
import { adminErrorResponse, asRunId, beginAdminRequest } from "@/lib/server/admin-route";
import { replyToFeedbackReport } from "@/lib/server/feedback-reply";

const NO_SUCH_REPORT = { code: "NOT_FOUND", message: "No such report." } as const;

/**
 * POST /api/admin/reports/:id/replies with {message, resolve}: emails a reply to the report's sender, at the address
 * on their account (which never comes back here), and resolves the report too when `resolve` is set and it went out.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/reports/[id]/replies">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(replyAdminFeedbackReportInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  // Report ids are positive integers, like sync run ids.
  const id = asRunId((await ctx.params).id);
  if (id === null) return adminErrorResponse(NO_SUCH_REPORT);
  try {
    const reply = await replyToFeedbackReport(session.db, id, input.data.message);
    if (input.data.resolve) await setAdminFeedbackReportResolved(session.db, id, true);
    return Response.json({ ok: true, data: reply } satisfies Result<AdminFeedbackReply>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
