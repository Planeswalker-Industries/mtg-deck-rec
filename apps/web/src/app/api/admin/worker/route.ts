import type { Result } from "@mtg/core/contract";
import type { AdminWorkerSchedule } from "@/lib/admin/types";
import { getAdminWorkerSchedule } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/worker
 *
 * The worker's schedule with each scheduled job's last start and success, the crawl sources, and the run-now asks
 * still waiting: what the admin home needs to say when each duty runs next.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  try {
    const schedule = await getAdminWorkerSchedule(session.db);
    return Response.json({ ok: true, data: schedule } satisfies Result<AdminWorkerSchedule>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
