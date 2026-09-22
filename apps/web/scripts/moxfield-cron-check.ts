/**
 * Checks the Moxfield cron route without a real deployment: Vercel's header, the unconfigured state, and the
 * forwarded POST to the search API. Both the search API and the platform that fires the cron are faked, so this
 * runs in CI where neither exists.
 *
 * Usage: yarn workspace @mtg/web tsx scripts/moxfield-cron-check.ts
 */
import { GET } from "../src/app/api/cron/moxfield-scrape/route";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

const CRON_PATH = "/cron/moxfield/scrape";

const save = { url: process.env.SEARCH_API_URL, token: process.env.SEARCH_API_CRON_TOKEN };

async function main() {
  // 1. The route only answers Vercel's own cron.
  check("a plain GET is refused", (await GET(new Request("https://mtg-app-psi.vercel.app/api/cron/moxfield-scrape"))).status === 401, "401");
  check(
    "a cron GET is recognised by the schedule header",
    (await GET(new Request("https://mtg-app-psi.vercel.app/api/cron/moxfield-scrape", { headers: { "x-vercel-cron-schedule": "15 10 * * *" } }))).status === 503,
    "503 (unconfigured, not refused)",
  );

  // 2. Configured-but-unreachable/no-upstream draws the "isn't configured" line, not a crawl attempt.
  process.env.SEARCH_API_URL = "https://search.example.com";
  delete process.env.SEARCH_API_CRON_TOKEN;
  const unconfigured = await GET(new Request("https://mtg-app-psi.vercel.app/api/cron/moxfield-scrape", { headers: { "x-vercel-cron-schedule": "15 10 * * *" } }));
  check("a cron without the crawl token is unconfigured", unconfigured.status === 503, "503");

  // 3. Configured and the upstream answers like the search API does: 202 started in the background.
  let seenURL = "";
  let seenAuth = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenURL = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    seenAuth = headers?.Authorization ?? "";
    return new Response(JSON.stringify({ started: true }), { status: 202 });
  }) as typeof fetch;

  process.env.SEARCH_API_CRON_TOKEN = "cron-secret";
  const started = await GET(new Request("https://mtg-app-psi.vercel.app/api/cron/moxfield-scrape", { headers: { "x-vercel-cron-schedule": "15 10 * * *" } }));
  check("the cron forwards a POST to the scrape endpoint", seenURL === "https://search.example.com" + CRON_PATH, seenURL);
  check("the crawl token travels as the bearer", seenAuth.includes("cron-secret"), seenAuth);
  const startedBody = (await started.json()) as { ok: boolean; started: boolean };
  check("the 202 comes through as started", started.status === 202 && startedBody.ok && startedBody.started, JSON.stringify(startedBody));

  // 4. A refused crawl (source disabled) is relayed honestly.
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "not configured" }), { status: 503 })) as typeof fetch;
  const refused = await GET(new Request("https://mtg-app-psi.vercel.app/api/cron/moxfield-scrape", { headers: { "x-vercel-cron-schedule": "15 10 * * *" } }));
  check("a disabled crawl is reported upstream as refused", refused.status === 503, "503");

  globalThis.fetch = realFetch;
  process.env.SEARCH_API_URL = save.url;
  if (save.token === undefined) delete process.env.SEARCH_API_CRON_TOKEN;
  else process.env.SEARCH_API_CRON_TOKEN = save.token;

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();