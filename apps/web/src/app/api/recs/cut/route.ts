import type { CutResult, Result } from "@mtg/core/contract";
import { getCutSuggestions, MAX_CUT_LIMIT } from "@/lib/server/recs";
import { createPublicClient } from "@/lib/server/supabase";
import { parseOptionalLimit, parseRecContext } from "@/lib/server/validate";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const context = parseRecContext(body?.context);
  if (!context.ok) return Response.json(context, { status: 400 });

  try {
    const data = await getCutSuggestions(createPublicClient(), {
      context: context.data,
      limit: parseOptionalLimit(body?.limit, MAX_CUT_LIMIT),
    });
    return Response.json({ ok: true, data } satisfies Result<CutResult>);
  } catch (err) {
    console.error(err);
    return Response.json(
      { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load cut suggestions. Try again in a moment." } } satisfies Result<CutResult>,
      { status: 503 },
    );
  }
}
