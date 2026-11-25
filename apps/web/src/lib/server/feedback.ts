import type { createAuthClient } from "./auth";
import { logError } from "./error-log";

type AuthClient = Awaited<ReturnType<typeof createAuthClient>>;

/** Stores a report from the signed-in caller (the function checks `auth.uid()` itself). Returns its id. */
export async function submitFeedbackReport(db: AuthClient, message: string, pagePath: string): Promise<number> {
  const { data, error } = await db.rpc("submit_feedback_report", { p_message: message, p_page_path: pagePath });
  if (error) throw new Error(`Saving a feedback report failed: ${error.message}`);
  return Number(data);
}

/** Open feedback reports and open error tickets, for a platform admin's header. */
export interface OpenAdminCounts {
  reports: number;
  errors: number;
}

/**
 * How many reports and error tickets are open, for the header's badges. Null for anyone who isn't a platform admin,
 * and when the read fails: the badges are a convenience and never stand in the header's way.
 *
 * A preview deploy runs against main's schema, which may not have admin_open_counts yet: then the reports count comes
 * from the older function and errors read 0.
 */
export async function openAdminCounts(db: AuthClient): Promise<OpenAdminCounts | null> {
  const { data, error } = await db.rpc("admin_open_counts");
  if (!error) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const counts = data as Record<string, unknown>;
    return { reports: Number(counts.reports ?? 0), errors: Number(counts.errors ?? 0) };
  }
  const older = await db.rpc("admin_open_feedback_report_count");
  if (older.error) {
    logError({ area: "admin.openCounts", error, level: "warning" });
    return null;
  }
  return older.data === null ? null : { reports: older.data, errors: 0 };
}
