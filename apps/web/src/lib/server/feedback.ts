import type { createAuthClient } from "./auth";

type AuthClient = Awaited<ReturnType<typeof createAuthClient>>;

/** Stores a report from the signed-in caller (the function checks `auth.uid()` itself). Returns its id. */
export async function submitFeedbackReport(db: AuthClient, message: string, pagePath: string): Promise<number> {
  const { data, error } = await db.rpc("submit_feedback_report", { p_message: message, p_page_path: pagePath });
  if (error) throw new Error(`Saving a feedback report failed: ${error.message}`);
  return Number(data);
}

/**
 * How many reports are open, for the header's badge. Null for anyone who isn't a platform admin, and when the read
 * fails: the badge is a convenience and never stands in the header's way.
 */
export async function openFeedbackReportCount(db: AuthClient): Promise<number | null> {
  const { data, error } = await db.rpc("admin_open_feedback_report_count");
  if (error) {
    console.error(`Counting open feedback reports failed: ${error.message}`);
    return null;
  }
  return data ?? null;
}
