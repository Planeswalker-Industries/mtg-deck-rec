"use server";

import { headers } from "next/headers";
import type { ActionsApi } from "@mtg/core/contract";
import { parseInput, reportClientErrorInputSchema } from "@mtg/core/schemas";
import { recordFailure } from "@/lib/server/error-log";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/**
 * A failure in the visitor's browser, as an error ticket (v41). Anyone may send one, signed in or not, within the
 * `client_error` budget in `app_config.rate_limits`. What the browser says is kept as it said it; what it can't vouch
 * for (the account, the time, the user agent, the deployment) the server adds itself.
 *
 * Answers ok even when the ticket couldn't be written: the page has nothing useful to do about that, and a report about
 * a failed report would loop.
 */
export async function reportClientErrorAction(
  input: Parameters<ActionsApi["reportClientError"]>[0],
): ReturnType<ActionsApi["reportClientError"]> {
  const parsed = parseInput(reportClientErrorInputSchema, input);
  if (!parsed.ok) return parsed;
  const report = parsed.data;
  const h = await headers();
  const limited = await checkRateLimit(createPublicClient(), "client_error", visitorKey(h));
  if (limited) return { ok: false, error: limited };

  await recordFailure(
    { area: report.area, error: report.message, code: report.code, context: report.context },
    "client",
    {
      pagePath: report.pagePath,
      userAgent: h.get("user-agent") ?? undefined,
      requestId: h.get("x-vercel-id") ?? undefined,
      cookieHeader: h.get("cookie") ?? undefined,
    },
    { name: report.name ?? "Error", message: report.message, ...(report.stack ? { stack: report.stack } : {}) },
  );
  return { ok: true, data: null };
}
