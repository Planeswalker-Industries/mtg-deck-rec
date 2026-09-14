import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

/** Cache tags the worker may refresh: `catalog` (cards, printings, tags), `corpus` (play-rate stats), `recs` (swap pools). */
const TAGS: ReadonlySet<string> = new Set(["catalog", "corpus", "recs"]);

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Marks cached pages and swap data stale after the worker commits new data behind them:
 * POST {"tags": ["corpus", "recs"]} with `Authorization: Bearer <REVALIDATE_SECRET>`. Each page refreshes when it's
 * next visited, serving its previous version once while the new one renders.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return Response.json({ ok: false, error: "Cache refresh isn't configured." }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(digest(token), digest(secret))) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags : [];
  if (tags.length === 0 || !tags.every((tag): tag is string => typeof tag === "string" && TAGS.has(tag))) {
    return Response.json({ ok: false, error: `List tags to refresh, from: ${[...TAGS].join(", ")}.` }, { status: 400 });
  }

  const unique = [...new Set(tags)];
  for (const tag of unique) revalidateTag(tag, "max");
  return Response.json({ ok: true, refreshed: unique });
}
