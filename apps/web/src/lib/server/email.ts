import { redactPersonalData, truncate } from "@mtg/core/errors";
import { USER_AGENT } from "@/lib/constants";

/**
 * Email the app sends on its own behalf (replies to feedback reports). Sign-in email is Supabase Auth's, not this.
 *
 * Production sends through Resend's HTTP API (`RESEND_API_KEY`), from `EMAIL_FROM` on the domain Resend verified
 * (T033). Locally, `MAILPIT_URL` sends through the local Supabase stack's Mailpit instead, so nothing leaves the
 * machine. With neither, sending is off and the admin page says so.
 */

const RESEND_URL = "https://api.resend.com/emails";
/** How long a send may take before it counts as failed. Resend answers in well under a second. */
const SEND_TIMEOUT_MS = 10_000;
/** A provider's error, cut to what the reply's record keeps. */
const MAX_FAILURE_CHARS = 1_000;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export type SendResult = { ok: true; providerMessageId: string | null } | { ok: false; failure: string };

interface EmailConfig {
  from: string;
  replyTo?: string;
  transport: { kind: "resend"; apiKey: string } | { kind: "mailpit"; url: string };
}

function emailConfig(): EmailConfig | null {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (apiKey) return { from, replyTo, transport: { kind: "resend", apiKey } };
  const mailpit = process.env.MAILPIT_URL?.trim();
  if (mailpit) return { from, replyTo, transport: { kind: "mailpit", url: mailpit.replace(/\/+$/, "") } };
  return null;
}

/** Whether the app can send email here: what the admin page reads to offer Reply. */
export function emailConfigured(): boolean {
  return emailConfig() !== null;
}

/** Whether replies to the app's email reach someone (EMAIL_REPLY_TO), so the email can say "reply to this". */
export function emailRepliesReachUs(): boolean {
  return Boolean(emailConfig()?.replyTo);
}

/** "Spell Chasm <hello@example.com>" as its parts; a bare address has no name. */
function parseAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return match ? { ...(match[1] ? { name: match[1] } : {}), email: match[2] ?? value } : { email: value.trim() };
}

/** Sends one plain-text email. Never throws: a failure comes back with the provider's reason, email addresses taken out. */
export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const config = emailConfig();
  if (!config) return { ok: false, failure: "Sending email isn't set up here (EMAIL_FROM with RESEND_API_KEY, or MAILPIT_URL locally)." };
  try {
    const res =
      config.transport.kind === "resend"
        ? await fetch(RESEND_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.transport.apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": USER_AGENT,
            },
            body: JSON.stringify({
              from: config.from,
              to: [email.to],
              subject: email.subject,
              text: email.text,
              ...(config.replyTo ? { reply_to: config.replyTo } : {}),
            }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          })
        : await fetch(`${config.transport.url}/api/v1/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
            body: JSON.stringify({
              From: {
                ...(parseAddress(config.from).name ? { Name: parseAddress(config.from).name } : {}),
                Email: parseAddress(config.from).email,
              },
              To: [{ Email: email.to }],
              Subject: email.subject,
              Text: email.text,
              ...(config.replyTo ? { ReplyTo: [{ Email: parseAddress(config.replyTo).email }] } : {}),
            }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const reason = typeof body?.message === "string" ? body.message : typeof body?.Error === "string" ? body.Error : `HTTP ${res.status}`;
      return {
        ok: false,
        failure: truncate(redactPersonalData(`${config.transport.kind === "resend" ? "Resend" : "Mailpit"}: ${reason}`), MAX_FAILURE_CHARS),
      };
    }
    const id = body?.id ?? body?.ID;
    return { ok: true, providerMessageId: typeof id === "string" ? id : null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, failure: truncate(redactPersonalData(`Couldn't reach the mail service: ${reason}`), MAX_FAILURE_CHARS) };
  }
}
