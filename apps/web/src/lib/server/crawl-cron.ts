/**
 * Shared trigger for the daily deck crawls (services/search-api `/cron/:source`).
 *
 * Vercel's cron fires a GET at one of the `/api/cron/*-scrape` routes; each route calls this with its source name.
 * This turns that into a POST to the crawl endpoint on the search API, which runs the scrape in the background and
 * answers 202 immediately. The crawl is asynchronous on purpose: a backfill can run for hours, and the cron function
 * must not stay alive that long.
 *
 * Two properties make this safe:
 *  * The authorization is Vercel's own header (`x-vercel-cron-schedule` / the `vercel-cron` user agent), so nobody
 *    can trigger it from outside the platform. The endpoint itself guards against a flood anyway: a source's atomic
 *    claim means overlapping triggers are no-ops.
 *  * Unconfigured means 503, not a broken crawl - the same stance as `/api/internal/revalidate`.
 */

/** The paths on the search API that getSearchIndex() reads SEARCH_API_URL / SEARCH_API_CRON_TOKEN from. */
const CRAWL_PATH = (source: string) => `/cron/${source}/scrape`;

export function isVercelCron(request: Request): boolean {
  // Vercel sets x-vercel-cron-schedule on cron invocations, and its user agent on every one of them.
  return request.headers.has("x-vercel-cron-schedule") || (request.headers.get("user-agent") ?? "").startsWith("vercel-cron");
}

export async function handleCrawlCron(request: Request, source: string): Promise<Response> {
  if (!isVercelCron(request)) {
    return Response.json({ ok: false, error: "This endpoint answers Vercel cron requests only." }, { status: 401 });
  }

  const base = process.env.SEARCH_API_URL;
  const token = process.env.SEARCH_API_CRON_TOKEN;
  if (!base || !token) {
    return Response.json({ ok: false, error: "The deck crawls aren't configured." }, { status: 503 });
  }

  const response = await fetch(`${base.replace(/\/$/, "")}${CRAWL_PATH(source)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => null)) as { started?: boolean } | null;
  return Response.json(
    { ok: response.ok, started: body?.started ?? false, upstreamStatus: response.status },
    { status: response.status },
  );
}