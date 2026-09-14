import type { Result, SwapResult } from "@mtg/core/contract";
import { getSwapSuggestions, MAX_SWAP_LIMIT, NotFoundError } from "@/lib/server/recs";
import { createPublicClient } from "@/lib/server/supabase";
import { parseOptionalLimit, parseRecContext } from "@/lib/server/validate";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const context = parseRecContext(body?.context);
  if (!context.ok) return Response.json(context, { status: 400 });
  const targetCardId = body?.targetCardId;
  if (!Number.isInteger(targetCardId) || (targetCardId as number) <= 0) {
    return Response.json({ ok: false, error: { code: "VALIDATION", message: "Pick a card to replace." } } satisfies Result<SwapResult>, {
      status: 400,
    });
  }

  try {
    const data = await getSwapSuggestions(createPublicClient(), {
      context: context.data,
      targetCardId: targetCardId as number,
      limit: parseOptionalLimit(body?.limit, MAX_SWAP_LIMIT),
    });
    return Response.json({ ok: true, data } satisfies Result<SwapResult>);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return Response.json({ ok: false, error: { code: "NOT_FOUND", message: err.message } } satisfies Result<SwapResult>, { status: 404 });
    }
    console.error(err);
    return Response.json(
      { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load replacements. Try again in a moment." } } satisfies Result<SwapResult>,
      { status: 503 },
    );
  }
}
