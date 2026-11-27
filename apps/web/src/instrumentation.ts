import type { Instrumentation } from "next";

/** Failures one instance remembers by request; far more than it serves at once, so a repeat always finds its first. */
const MAX_REMEMBERED_REQUEST_FAILURES = 500;

/** Request id and digest of the failures already reported, oldest first. */
const reportedInRequest = new Set<string>();

/**
 * Next reports a failure once for every part of the render that awaited it: a card page whose read failed throws in
 * both generateMetadata and the page, the same digest under the same request id. Only the first is written. Without a
 * request id (local runs) or a digest, every report is.
 */
function firstReportInRequest(requestId: string | undefined, error: unknown): boolean {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  if (!requestId || !digest) return true;
  const key = `${requestId}:${digest}`;
  if (reportedInRequest.has(key)) return false;
  reportedInRequest.add(key);
  if (reportedInRequest.size > MAX_REMEMBERED_REQUEST_FAILURES) {
    const oldest = reportedInRequest.values().next().value;
    if (oldest !== undefined) reportedInRequest.delete(oldest);
  }
  return true;
}

/**
 * Failures nothing else caught: a Server Component that threw while rendering, a Route Handler or Server Action that
 * threw instead of answering, the proxy. Each opens or joins an error ticket (`lib/server/error-log.ts`), keyed by
 * where it happened, so a page that keeps breaking is one ticket however many visitors hit it.
 *
 * The digest is what the visitor's error page shows ("Error id"), so a player's screenshot finds its ticket.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The ticket writer needs Node (node:crypto, the Supabase client); nothing here runs on the edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  if (!firstReportInRequest(header("x-vercel-id"), error)) return;
  const { recordFailure } = await import("@/lib/server/error-log");
  const { sitePath } = await import("@mtg/core/errors");
  // An action or an API call happened on the page that sent it; a page render happened on the page itself.
  const pagePath = context.routeType === "render" ? sitePath(request.path) : (sitePath(header("referer")) ?? sitePath(request.path));
  await recordFailure({ area: `${context.routeType}:${context.routePath}`, error }, "server", {
    pagePath,
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    userAgent: header("user-agent"),
    requestId: header("x-vercel-id"),
    actionId: header("next-action"),
    cookieHeader: header("cookie"),
  });
};
