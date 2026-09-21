import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminTagsInputSchema } from "@/lib/admin/schemas";
import type { AdminTagPage } from "@/lib/admin/types";
import { listAdminTags } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/tags?q=&disabledOnly=1&functionalOnly=1&sort=card_count&order=DESC&offset=0&limit=25
 *
 * The tag list behind /admin/tags. Never cached: it shows who switched what off.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const search = params.get("q")?.trim();
  const sort = params.get("sort");
  const offset = params.get("offset");
  const limit = params.get("limit");
  const input = parseInput(listAdminTagsInputSchema, {
    ...(search ? { search } : {}),
    disabledOnly: params.get("disabledOnly") === "1",
    functionalOnly: params.get("functionalOnly") === "1",
    ...(sort ? { sort } : {}),
    ascending: params.get("order")?.toUpperCase() === "ASC",
    ...(offset ? { offset: Number(offset) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const data = await listAdminTags(session.db, input.data);
    return Response.json({ ok: true, data } satisfies Result<AdminTagPage>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
