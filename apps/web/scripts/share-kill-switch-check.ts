/**
 * Checks the share-link kill switch against the local database without contacting any site: fetch is faked to answer
 * like a Cloudflare challenge, and the source must end up switched off with an audit entry. The source is switched back
 * on afterwards.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/share-kill-switch-check.ts
 */
import { fetchShareLink } from "../src/lib/server/share-import";
import { createPublicClient } from "../src/lib/server/supabase";
import { createAdminClient } from "../src/lib/server/supabase-admin";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

const link = { source: "archidekt" as const, url: "https://archidekt.com/api/decks/1/", expects: "json" as const, what: "deck" as const };

async function main() {
  const db = createPublicClient();
  const admin = createAdminClient();
  const realFetch = globalThis.fetch;
  let requests = 0;

  // Only requests to the share site are faked; the database client keeps using the real network.
  const answerWith = (status: number, headers: Record<string, string>, body: string) => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!new URL(url).hostname.endsWith("archidekt.com")) return realFetch(input, init);
      requests++;
      return new Response(body, { status, headers });
    }) as typeof fetch;
  };
  const sourceEnabled = async () => {
    const { data } = await db.from("share_import_sources").select("enabled").eq("source", "archidekt").maybeSingle();
    return data?.enabled;
  };
  const switchBackOn = () =>
    admin.from("share_import_sources").update({ enabled: true, disabled_at: null, disabled_reason: null, last_blocked_status: null }).eq("source", "archidekt");

  try {
    await switchBackOn();

    answerWith(403, { "content-type": "application/json" }, '{"detail":"You do not have permission to perform this action."}');
    const privateList = await fetchShareLink(db, link);
    check("private list (403 in the usual format)", !privateList.ok && privateList.error.code === "NOT_FOUND", privateList.ok ? "ok" : privateList.error.message);
    check("still switched on after a private list", (await sourceEnabled()) === true, `enabled=${await sourceEnabled()}`);

    answerWith(403, { "content-type": "text/html", "cf-mitigated": "challenge" }, "<html><title>Just a moment...</title></html>");
    const blocked = await fetchShareLink(db, link);
    check("challenge response", !blocked.ok && blocked.error.code === "UPSTREAM_NOT_AUTHORIZED", blocked.ok ? "ok" : blocked.error.message);
    check("switched off after the challenge", (await sourceEnabled()) === false, `enabled=${await sourceEnabled()}`);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, payload, created_at")
      .eq("action", "share_import_source_disabled")
      .order("created_at", { ascending: false })
      .limit(1);
    check("audit entry written", audit?.[0]?.action === "share_import_source_disabled", JSON.stringify(audit?.[0]?.payload ?? null));

    const before = requests;
    answerWith(200, { "content-type": "application/json" }, '{"cards":[],"categories":[]}');
    const afterSwitchOff = await fetchShareLink(db, link);
    check("no request once switched off", requests === before, `${requests - before} requests`);
    check("switched-off message", !afterSwitchOff.ok && /switched off/.test(afterSwitchOff.error.message), afterSwitchOff.ok ? "ok" : afterSwitchOff.error.message);

    let refused = false;
    try {
      await fetchShareLink(db, { ...link, url: "https://example.com/api/decks/1/" });
    } catch {
      refused = true;
    }
    check("refuses hosts outside the source", refused, refused ? "threw" : "fetched");
  } finally {
    globalThis.fetch = realFetch;
    await switchBackOn();
    console.log(`archidekt switched back on: ${await sourceEnabled()}`);
  }

  console.log(failures.length ? `FAILURES: ${failures.join(", ")}` : "all kill switch checks passed");
  if (failures.length) process.exitCode = 1;
}

void main();
