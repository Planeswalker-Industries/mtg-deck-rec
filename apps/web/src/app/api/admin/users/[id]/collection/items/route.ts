import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { searchAdminCollectionInputSchema } from "@/lib/admin/schemas";
import type { AdminCollectionItemPage } from "@/lib/admin/types";
import { searchAdminUserCollection } from "@/lib/server/admin";
import { adminErrorResponse, asUserId, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/users/{id}/collection/items?search=sol&offset=0&limit=50
 *
 * Entries of one account's collection whose card name contains the search, a page at a time. There is no listing
 * without a search. Each call writes one audit row holding the search's length, never its text.
 */

const NO_SUCH_USER = { code: "NOT_FOUND", message: "No such user." } as const;

/** A query parameter as a number, or undefined when absent so the schema's default applies. */
const numberParam = (value: string | null) => (value === null || value === "" ? undefined : Number(value));

export async function GET(request: Request, ctx: RouteContext<"/api/admin/users/[id]/collection/items">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asUserId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_USER);

  const params = new URL(request.url).searchParams;
  const input = parseInput(searchAdminCollectionInputSchema, {
    search: params.get("search") ?? "",
    offset: numberParam(params.get("offset")),
    limit: numberParam(params.get("limit")),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const page = await searchAdminUserCollection(session.db, id, input.data);
    return Response.json({ ok: true, data: page } satisfies Result<AdminCollectionItemPage>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
