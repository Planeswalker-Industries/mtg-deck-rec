import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminCrawledDecksInputSchema } from "@/lib/admin/schemas";
import type { AdminCrawledDeckPage, AdminCrawlSource } from "@/lib/admin/types";
import { listAdminCrawledDecks, listAdminCrawlSources } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/crawls?source=archidekt&search=liesa&offset=0&limit=25
 *
 * The state of each crawl source and a page of the decks it has written. Both in one answer because the page shows
 * both at once, and two requests would draw the header after the list.
 *
 * `no-store`, like the rest of the admin surface: these are third-party decklists behind a platform-admin check, and
 * nothing about them belongs in a shared cache.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const source = params.get("source");
  const search = params.get("search");
  const offset = params.get("offset");
  const limit = params.get("limit");
  const input = parseInput(listAdminCrawledDecksInputSchema, {
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
    ...(offset ? { offset: Number(offset) } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const [sources, page] = await Promise.all([
      listAdminCrawlSources(session.db),
      listAdminCrawledDecks(session.db, input.data),
    ]);
    return Response.json({ ok: true, data: { sources, page } } satisfies Result<{ sources: AdminCrawlSource[]; page: AdminCrawledDeckPage }>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
