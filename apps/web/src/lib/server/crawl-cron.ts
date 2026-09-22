/**
 * Shared trigger for the daily deck crawls (services/search-api `/cron/:source`).
 *
 * Vercel's cron fires a GET at one of the `/api/cron/*-scrape` routes; each route calls this with its source name.
 * This turns that into a POST to the crawl endpoint on the search API, which runs the scrape in the background and
 * answers 202 immediately. The crawl is asynchronous on purpose: a backfill can run for hours, and the cron function
 * must not stay alive that long.
 *
 * **Authorization is `CRON_SECRET`, never a header Vercel happens to set.** Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on every cron invocation when that variable is set on the project, and that
 * bearer is the only thing this route trusts. `x-vercel-cron-schedule` and the `vercel-cron` user agent are ordinary
 * inbound request headers that any caller can type, so treating them as proof of origin would leave an open endpoint
 * that drives outbound crawling of a third party — the one thing the politeness guardrails exist to bound.
 * Unconfigured means 503, not an open door, the same stance as `/api/internal/revalidate`.
 */
import { timingSafeEqual } from "node:crypto";

/** The path on the search API that a source's scrape is triggered through. */
const CRAWL_PATH = (source: string) => `/cron/${source}/scrape`;

/** How long to wait for the search API to accept the trigger. It answers 202 at once; the crawl outlives the call. */
const TRIGGER_TIMEOUT_MS = 30_000;

/** Constant-time compare of two secrets of unknown length. */
function secretsMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return secretsMatch(header.slice("Bearer ".length).trim(), secret);
}

export async function handleCrawlCron(request: Request, source: string): Promise<Response> {
  // An unset CRON_SECRET is a misconfiguration, and the honest answer to it is "this cannot run", not "let anyone
  // run it". Vercel's dashboard is where the variable lives; the route stays shut until it does.
  if (!process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "The deck crawls aren't configured." }, { status: 503 });
  }
  if (!isAuthorizedCron(request)) {
    return Response.json({ ok: false, error: "This endpoint answers the scheduler only." }, { status: 401 });
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
    signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { started?: boolean } | null;
  return Response.json(
    { ok: response.ok, started: body?.started ?? false, upstreamStatus: response.status },
    { status: response.status },
  );
}
