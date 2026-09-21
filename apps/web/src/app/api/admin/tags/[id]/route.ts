import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { revalidateTag } from "next/cache";
import { updateAdminTagInputSchema } from "@/lib/admin/schemas";
import type { AdminTag } from "@/lib/admin/types";
import { getAdminTag, setAdminTagDisabled } from "@/lib/server/admin";
import { adminErrorResponse, asTagId, beginAdminRequest } from "@/lib/server/admin-route";

/** One tag: read it, or throw its kill switch. Both answer with the tag as it stands afterwards. */

const NO_SUCH_TAG = { code: "NOT_FOUND", message: "No such tag." } as const;

/**
 * What a switched tag changes. Recommendations read `functional_tags`, which already skips disabled tags, but cached
 * swap pools (`recs`) and card pages' tag lists (`catalog`) were built with the old answer. "max" serves each stale
 * page once while the new one renders, the same as after a sync.
 */
const CACHES_A_TAG_FEEDS = ["recs", "catalog"] as const;

export async function GET(request: Request, ctx: RouteContext<"/api/admin/tags/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const id = asTagId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_TAG);
  try {
    const tag = await getAdminTag(session.db, id);
    if (!tag) return adminErrorResponse(NO_SUCH_TAG);
    return Response.json({ ok: true, data: tag } satisfies Result<AdminTag>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/tags/[id]">): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(updateAdminTagInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  const id = asTagId((await ctx.params).id);
  if (!id) return adminErrorResponse(NO_SUCH_TAG);
  try {
    const before = await getAdminTag(session.db, id);
    if (!before) return adminErrorResponse(NO_SUCH_TAG);
    await setAdminTagDisabled(session.db, id, input.data);
    if (before.disabled !== input.data.disabled) {
      for (const tag of CACHES_A_TAG_FEEDS) revalidateTag(tag, "max");
    }
    const tag = await getAdminTag(session.db, id);
    if (!tag) return adminErrorResponse(NO_SUCH_TAG);
    return Response.json({ ok: true, data: tag } satisfies Result<AdminTag>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
