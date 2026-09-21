import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminSyncRunsInputSchema } from "@/lib/admin/schemas";
import type { AdminSyncRunPage } from "@/lib/admin/types";
import { listAdminSyncRuns } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/sync-runs?job=scryfall_catalog&status=failed&order=DESC&offset=0&limit=25
 *
 * The worker's run history, newest first. Read-only: runs are written by the jobs themselves.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const job = params.get("job");
  const status = params.get("status");
  const offset = params.get("offset");
  const limit = params.get("limit");
  const input = parseInput(listAdminSyncRunsInputSchema, {
    ...(job ? { job } : {}),
    ...(status ? { status } : {}),
    ascending: params.get("order")?.toUpperCase() === "ASC",
    ...(offset ? { offset: Number(offset) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const data = await listAdminSyncRuns(session.db, input.data);
    return Response.json({ ok: true, data } satisfies Result<AdminSyncRunPage>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
