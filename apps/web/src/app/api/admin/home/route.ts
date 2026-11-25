import type { Result } from "@mtg/core/contract";
import type { AdminSiteStats } from "@/lib/admin/types";
import { getAdminSiteStats } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/home
 *
 * The site's numbers for the admin home: accounts, saved decks, collections, imports this week, open reports and open
 * error tickets. Counted live on every request, so `no-store` like the rest of the admin surface.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  try {
    const stats = await getAdminSiteStats(session.db);
    return Response.json({ ok: true, data: stats } satisfies Result<AdminSiteStats>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
