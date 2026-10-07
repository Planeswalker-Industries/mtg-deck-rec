import type { Result } from "@mtg/core/contract";
import { parseInput } from "@mtg/core/schemas";
import { listAdminAcceptRatesInputSchema } from "@/lib/admin/schemas";
import type { AdminAcceptRate } from "@/lib/admin/types";
import { listAdminAcceptRates } from "@/lib/server/admin";
import { adminErrorResponse, beginAdminRequest } from "@/lib/server/admin-route";

/**
 * GET /api/admin/accept-rates?mode=add&days=30
 *
 * The live accept rate (T065): per kind of list and position, how often suggestions were shown, taken and passed on.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await beginAdminRequest(request);
  if ("error" in session) return adminErrorResponse(session.error);

  const params = new URL(request.url).searchParams;
  const mode = params.get("mode");
  const days = params.get("days");
  const input = parseInput(listAdminAcceptRatesInputSchema, { ...(mode ? { mode } : {}), ...(days ? { days: Number(days) } : {}) });
  if (!input.ok) return adminErrorResponse(input.error);

  try {
    const data = await listAdminAcceptRates(session.db, input.data);
    return Response.json({ ok: true, data } satisfies Result<AdminAcceptRate[]>, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
