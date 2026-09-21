import type { Result } from "@mtg/core/contract";
import type { AdminSyncRun } from "@/lib/admin/types";
import { getAdminSyncRun } from "@/lib/server/admin";
import { adminErrorResponse, asRunId, beginAdminRequest } from "@/lib/server/admin-route";

const NO_SUCH_RUN = { code: "NOT_FOUND", message: "No such sync run." } as const;

/** One sync run, with its metrics and error. */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/sync-runs/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asRunId((await ctx.params).id);
  if (id === null) return adminErrorResponse(NO_SUCH_RUN);
  try {
    const run = await getAdminSyncRun(session.db, id);
    if (!run) return adminErrorResponse(NO_SUCH_RUN);
    return Response.json({ ok: true, data: run } satisfies Result<AdminSyncRun>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
