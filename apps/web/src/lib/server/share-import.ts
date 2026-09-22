import type { ApiError } from "@mtg/core/contract";
import { classifyShareResponse } from "@mtg/core/parse";
import { createAdminClient } from "./supabase-admin";
import type { PublicClient } from "./supabase";

export type ShareSource = "archidekt" | "manabox" | "moxfield" | "tcgplayer";

const SOURCES: Record<ShareSource, { name: string; hosts: readonly string[] }> = {
  archidekt: { name: "Archidekt", hosts: ["archidekt.com"] },
  manabox: { name: "ManaBox", hosts: ["manabox.app"] },
  moxfield: { name: "Moxfield", hosts: ["moxfield.com", "api2.moxfield.com"] },
  tcgplayer: { name: "TCGplayer", hosts: ["tcgplayer.com", "www.tcgplayer.com"] },
};

/** Identifies the app honestly on every outbound request (the worker sends the same). */
const USER_AGENT = "MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)";
const TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 5_000_000;

export type ShareFetchResult = { ok: true; body: string } | { ok: false; error: ApiError };

const failure = (code: ApiError["code"], message: string): ShareFetchResult => ({ ok: false, error: { code, message } });

const isAllowedHost = (source: ShareSource, url: URL) =>
  url.protocol === "https:" && SOURCES[source].hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));

/**
 * Fetches a list for a share link the user pasted: one request, with an honest User-Agent, to a URL the app built for
 * that source's own hosts (never an arbitrary URL, and redirects aren't followed). If the site answers with bot
 * protection, that source's imports are switched off for everyone until someone turns them back on; the app never
 * retries or works around a block.
 */
export async function fetchShareLink(
  db: PublicClient,
  {
    source,
    url,
    expects,
    what,
    json,
  }: {
    source: ShareSource;
    url: string;
    expects: "json" | "html" | "text";
    what: "deck" | "collection";
    /** Sent as a JSON POST body. Only for endpoints the source's own site calls the same way (Archidekt's export). */
    json?: unknown;
  },
): Promise<ShareFetchResult> {
  const { name } = SOURCES[source];
  const target = new URL(url);
  if (!isAllowedHost(source, target)) throw new Error(`Refusing to fetch ${target.hostname} as a ${name} link.`);

  const { data: status, error } = await db.from("share_import_sources").select("enabled").eq("source", source).maybeSingle();
  if (error) throw new Error(`Checking whether ${name} imports are on failed: ${error.message}`);
  if (status && !status.enabled) {
    return failure("UPSTREAM_NOT_AUTHORIZED", `Importing ${name} links is switched off right now. Export the ${what} as text in ${name} and paste it here instead.`);
  }

  let res: Response;
  let body: string;
  try {
    res = await fetch(target, {
      method: json === undefined ? "GET" : "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: expects === "json" ? "application/json" : "text/html,text/plain;q=0.9,*/*;q=0.5",
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "manual",
    });
    body = await res.text();
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", `Couldn't reach ${name}. Try again in a moment.`);
  }
  if (body.length > MAX_BODY_CHARS) return failure("PAYLOAD_TOO_LARGE", `That ${name} ${what} is too large to import.`);

  switch (classifyShareResponse({ status: res.status, headers: res.headers, body: body.slice(0, 20_000), expects })) {
    case "ok":
      return { ok: true, body };
    case "bot_blocked":
      await switchOff(source, res.status);
      return failure(
        "UPSTREAM_NOT_AUTHORIZED",
        `${name} is blocking automated requests, so importing ${name} links is now switched off. Export the ${what} as text in ${name} and paste it here instead.`,
      );
    case "not_public":
    case "not_found":
      return failure("NOT_FOUND", `That ${name} ${what} isn't public, or doesn't exist.`);
    case "rate_limited":
      return failure("RATE_LIMITED", `${name} is busy right now. Wait a minute and try the link again.`);
    default:
      return failure("UPSTREAM_UNAVAILABLE", `Couldn't load that ${name} ${what}. Try again in a moment.`);
  }
}

/** Switches a source off and records why. Failing to record it is logged loudly but never hides the block from the user. */
async function switchOff(source: ShareSource, status: number): Promise<void> {
  console.warn(`share import: switching off ${source} after a bot-protection response (HTTP ${status})`);
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { error } = await admin
      .from("share_import_sources")
      .update({ enabled: false, disabled_at: now, disabled_reason: "bot protection", last_blocked_status: status, updated_at: now })
      .eq("source", source);
    if (error) throw new Error(error.message);
    const { error: auditError } = await admin.from("audit_log").insert({ action: "share_import_source_disabled", payload: { source, status } });
    if (auditError) console.error(`Recording that ${source} imports were switched off failed: ${auditError.message}`);
  } catch (err) {
    console.error(`Couldn't switch off ${source} imports:`, err);
  }
}
