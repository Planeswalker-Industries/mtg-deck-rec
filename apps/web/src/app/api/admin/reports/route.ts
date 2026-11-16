import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminFeedbackReportsInputSchema } from "@/lib/admin/schemas";
import type { AdminFeedbackReportPage } from "@/lib/admin/types";
import { listAdminFeedbackReports } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/reports?open=0&offset=0&limit=25
 *
 * A page of feedback reports, newest first: open ones only unless `open=0`. `no-store`, like the rest of the admin
 * surface.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const open = params.get("open");
  const offset = params.get("offset");
  const limit = params.get("limit");
  const input = parseInput(listAdminFeedbackReportsInputSchema, {
    ...(open !== null ? { openOnly: open !== "0" } : {}),
    ...(offset ? { offset: Number(offset) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const page = await listAdminFeedbackReports(session.db, input.data);
    return Response.json({ ok: true, data: page } satisfies Result<AdminFeedbackReportPage>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
