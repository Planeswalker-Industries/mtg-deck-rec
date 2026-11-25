import type { AdminFeedbackReply } from "@/lib/admin/types";
import { SITE_NAME } from "@/lib/constants";
import { SITE_URL } from "@/lib/site";
import { AdminError, asAdminError, type AuthedClient } from "./admin";
import { emailConfigured, emailRepliesReachUs, sendEmail } from "./email";
import { logError } from "./error-log";
import { createAdminClient } from "./supabase-admin";

/** How the email dates the report it answers. */
const SENT_ON = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

/**
 * Emails a reply to a feedback report's sender, at the address on their account, and records it. The admin's session
 * starts and finishes the record (so it's theirs, checked as an admin by the database); the address is read with the
 * service role and goes straight to the mail service, never back to the admin.
 *
 * Throws AdminError with what the admin can do about it: email not set up, no address, the mail service refusing.
 */
export async function replyToFeedbackReport(db: AuthedClient, reportId: number, message: string): Promise<AdminFeedbackReply> {
  if (!emailConfigured()) {
    throw new AdminError("Sending email isn't set up on this deployment yet, so replies can't go out.", "UPSTREAM_NOT_AUTHORIZED");
  }

  const recipient = await createAdminClient().rpc("feedback_report_recipient", { p_report_id: reportId });
  if (recipient.error) throw asAdminError(recipient.error);
  if (!recipient.data) throw new AdminError("That report is gone, or its sender's account has no email address.", "NOT_FOUND");

  const started = await db.rpc("admin_start_feedback_reply", { p_report_id: reportId, p_message: message });
  if (started.error) throw asAdminError(started.error);
  const record = started.data?.[0];
  if (!record) throw new AdminError("That report is gone.", "NOT_FOUND");

  const sent = await sendEmail({
    to: recipient.data,
    subject: `Re: your feedback to ${SITE_NAME}`,
    text: replyText(message.trim(), record),
  });

  const finished = await db.rpc("admin_finish_feedback_reply", {
    p_reply_id: Number(record.reply_id),
    p_sent: sent.ok,
    ...(sent.ok ? (sent.providerMessageId ? { p_provider_message_id: sent.providerMessageId } : {}) : { p_failure: sent.failure }),
  });
  if (finished.error) {
    // The email's fate is known but unrecorded: the reply stays 'sending'. Worth a ticket, not a failed request.
    logError({ area: "feedback.reply.record", error: finished.error, context: { replyId: Number(record.reply_id), sent: sent.ok } });
  }

  if (!sent.ok) {
    logError({ area: "feedback.reply.send", error: sent.failure, context: { reportId, replyId: Number(record.reply_id) } });
    throw new AdminError(`The reply wasn't sent. ${sent.failure}`, "UPSTREAM_UNAVAILABLE");
  }
  return { id: Number(record.reply_id), message: message.trim(), status: "sent", failure: null, createdAt: new Date().toISOString() };
}

/** The email's text: the reply, then the report it answers, quoted, so the player knows what it's about. */
function replyText(reply: string, report: { report_message: string; report_page_path: string; report_created_at: string }): string {
  const quoted = report.report_message
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return [
    "Hi,",
    "",
    reply,
    "",
    `— ${SITE_NAME}`,
    "",
    emailRepliesReachUs() ? "You can reply to this email to answer us." : `To answer, send feedback again from ${SITE_URL}.`,
    "",
    `You sent this on ${SENT_ON.format(new Date(report.report_created_at))}, from ${SITE_URL}${report.report_page_path}:`,
    "",
    quoted,
    "",
  ].join("\n");
}
