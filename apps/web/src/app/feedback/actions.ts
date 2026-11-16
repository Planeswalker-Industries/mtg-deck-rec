"use server";

import { headers } from "next/headers";
import type { ActionsApi } from "@mtg/core/contract";
import { parseInput, submitFeedbackInputSchema } from "@mtg/core/schemas";
import { NotSignedInError, requireUserId } from "@/lib/server/account-collection";
import { createAuthClient } from "@/lib/server/auth";
import { submitFeedbackReport } from "@/lib/server/feedback";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/** Sends the site's admins a feedback report. Signed in only, with its own budget in `app_config.rate_limits`. */
export async function submitFeedbackAction(input: Parameters<ActionsApi["submitFeedback"]>[0]): ReturnType<ActionsApi["submitFeedback"]> {
  const parsed = parseInput(submitFeedbackInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const db = await createAuthClient();
    await requireUserId(db);
    const limited = await checkRateLimit(createPublicClient(), "feedback", visitorKey(await headers()));
    if (limited) return { ok: false, error: limited };
    const id = await submitFeedbackReport(db, parsed.data.message, parsed.data.pagePath);
    return { ok: true, data: { id } };
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign in to send feedback." } };
    }
    console.error(err);
    return { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't send that. Try again in a moment." } };
  }
}
