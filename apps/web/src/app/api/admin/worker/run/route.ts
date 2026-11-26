import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { requestWorkerRunInputSchema } from "@/lib/admin/schemas";
import { requestAdminWorkerRun } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * POST /api/admin/worker/run { duty }
 *
 * Asks the worker to run a duty (or `crawl:<source>`) on its next pass, a few seconds away. Answers with the waiting
 * ask; asking again while one waits changes nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const input = parseInput(requestWorkerRunInputSchema, await request.json().catch(() => null));
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const ask = await requestAdminWorkerRun(session.db, input.data.duty);
    return Response.json({ ok: true, data: ask } satisfies Result<{ duty: string; requestedAt: string }>, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
