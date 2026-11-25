import type { Instrumentation } from "next";

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
  const { recordFailure } = await import("@/lib/server/error-log");
  const { sitePath } = await import("@mtg/core/errors");
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
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
