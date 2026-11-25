import type { ClientErrorReport } from "@mtg/core/contract";
import { ERROR_AREA_PATTERN, MAX_ERROR_STACK_CHARS, boundContext, describeError, sitePath, truncate } from "@mtg/core/errors";
import { getApis } from "@/lib/api/client";

/**
 * Sends a failure in the browser to the server, where it opens or joins an error ticket (`reportClientError`, v41).
 * Fire and forget: it never throws and never waits, and a report that can't be sent is dropped.
 *
 * Failures the server already ticketed (a call that came back UPSTREAM_UNAVAILABLE, a render error with a digest) don't
 * need sending again; this is for what only the browser sees: a parser or worker that threw, a render error in a
 * client component, an unhandled rejection.
 */

/** Reports one page load sends at most: a page stuck in a loop shouldn't spend the visitor's whole budget. */
const MAX_REPORTS_PER_PAGE_LOAD = 10;

const sent = new Set<string>();

export function reportClientError(area: string, error: unknown, extra: { code?: string; context?: Record<string, unknown> } = {}): void {
  if (typeof window === "undefined") return;
  try {
    const described = describeError(error);
    // The same failure twice on one page load is one report; the ticket's count is for separate visits.
    const key = `${area}|${described.message}`;
    if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE_LOAD) return;
    sent.add(key);
    const report: ClientErrorReport = {
      area: ERROR_AREA_PATTERN.test(area) ? area : "unknown",
      message: described.message,
      pagePath: sitePath(window.location.pathname) ?? "/",
      name: described.name,
      ...(described.stack ? { stack: truncate(described.stack, MAX_ERROR_STACK_CHARS) } : {}),
      ...(extra.code ? { code: extra.code } : {}),
      ...(boundContext(extra.context) ? { context: boundContext(extra.context) } : {}),
    };
    void getApis()
      .actions.reportClientError(report)
      .catch(() => undefined);
  } catch {
    // Reporting must never be what breaks the page.
  }
}
