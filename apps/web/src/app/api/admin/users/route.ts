import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminUsersInputSchema } from "@/lib/admin/schemas";
import type { AdminUserPage } from "@/lib/admin/types";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";
import { listAdminUsers } from "@/lib/server/admin";

/**
 * GET /api/admin/users?q=&adminsOnly=1&sort=created_at&order=DESC&offset=0&limit=25
 *
 * The user list behind /admin. Never cached and never served to the CDN: it is per-caller data about accounts.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const search = params.get("q")?.trim();
  const userId = params.get("id");
  const sort = params.get("sort");
  const offset = params.get("offset");
  const limit = params.get("limit");
  const input = parseInput(listAdminUsersInputSchema, {
    ...(userId ? { userId } : {}),
    ...(search ? { search } : {}),
    adminsOnly: params.get("adminsOnly") === "1",
    ...(sort ? { sort } : {}),
    ascending: params.get("order")?.toUpperCase() === "ASC",
    ...(offset ? { offset: Number(offset) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const data = await listAdminUsers(session.db, input.data);
    return Response.json({ ok: true, data } satisfies Result<AdminUserPage>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
