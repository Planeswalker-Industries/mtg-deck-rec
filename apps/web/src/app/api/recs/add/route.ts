import type { AddResult, Result } from "@mtg/core/contract";
import { getAddSuggestions } from "@/lib/server/recs";
import { createPublicClient } from "@/lib/server/supabase";
import { parseRecContext } from "@/lib/server/validate";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const context = parseRecContext(body?.context);
  if (!context.ok) return Response.json(context, { status: 400 });

  try {
    const data = await getAddSuggestions(createPublicClient(), { context: context.data });
    return Response.json({ ok: true, data } satisfies Result<AddResult>);
  } catch (err) {
    console.error(err);
    return Response.json(
      { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't load suggestions. Try again in a moment." } } satisfies Result<AddResult>,
      { status: 503 },
    );
  }
}
