import type { Result } from "@mtg/core/contract";
import type { AdminCrawlSource } from "@/lib/admin/types";
import { listAdminCrawlSources } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/crawls/sources
 *
 * The state of each crawl source alone, for the admin home. `/api/admin/crawls` also pages the crawled decks, and
 * counting them reads every row of `crawl.decks`, which the home never shows.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  try {
    const sources = await listAdminCrawlSources(session.db);
    return Response.json({ ok: true, data: { sources } } satisfies Result<{ sources: AdminCrawlSource[] }>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
