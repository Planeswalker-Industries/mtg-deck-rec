/**
 * Checks the Archidekt cron route without a real deployment: the CRON_SECRET gate, the unconfigured state, and the
 * forwarded POST to the search API. Both the search API and the scheduler are faked, so this runs in CI where
 * neither exists. The Moxfield route shares the same helper; this pins the Archidekt half.
 *
 * Usage: yarn workspace @mtg/web tsx scripts/archidekt-cron-check.ts
 */
import { GET } from "../src/app/api/cron/archidekt-scrape/route";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

const CRON_PATH = "/cron/archidekt/scrape";
const ROUTE = "https://mtg-app-psi.vercel.app/api/cron/archidekt-scrape";
const SECRET = "cron-secret-value";

const save = {
  url: process.env.SEARCH_API_URL,
  token: process.env.SEARCH_API_CRON_TOKEN,
  secret: process.env.CRON_SECRET,
};

const get = (headers?: Record<string, string>) => GET(new Request(ROUTE, { headers }));

async function main() {
  // 1. Without CRON_SECRET the route cannot run at all - it never falls open.
  delete process.env.CRON_SECRET;
  check("unconfigured is refused", (await get()).status === 503, "503");

  // 2. With it, only the bearer gets in. The headers Vercel happens to set are not proof of anything: any caller can
  //    type them, and this endpoint drives outbound crawling of someone else's site.
  process.env.CRON_SECRET = SECRET;
  check("a plain GET is refused", (await get()).status === 401, "401");
  check(
    "a spoofed vercel-cron user agent is refused",
    (await get({ "user-agent": "vercel-cron/1.0" })).status === 401,
    "401",
  );
  check(
    "a spoofed cron schedule header is refused",
    (await get({ "x-vercel-cron-schedule": "15 10 * * *" })).status === 401,
    "401",
  );
  check("a wrong bearer is refused", (await get({ authorization: "Bearer nope" })).status === 401, "401");
  check(
    "the right bearer gets through to the unconfigured upstream",
    (await get({ authorization: `Bearer ${SECRET}` })).status === 503,
    "503 (unconfigured, not refused)",
  );

  // 3. Configured and the upstream answers like the search API does: 202 started in the background.
  process.env.SEARCH_API_URL = "https://search.example.com";
  process.env.SEARCH_API_CRON_TOKEN = "search-api-cron-token";
  let seenURL = "";
  let seenAuth = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenURL = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    seenAuth = headers?.Authorization ?? "";
    return new Response(JSON.stringify({ started: true }), { status: 202 });
  }) as typeof fetch;

  const started = await get({ authorization: `Bearer ${SECRET}` });
  check("the cron forwards a POST to the scrape endpoint", seenURL === "https://search.example.com" + CRON_PATH, seenURL);
  check(
    "the search API's own token travels as the bearer, not the cron secret",
    seenAuth === "Bearer search-api-cron-token",
    seenAuth,
  );
  const startedBody = (await started.json()) as { ok: boolean; started: boolean };
  check("the 202 comes through as started", started.status === 202 && startedBody.ok && startedBody.started, JSON.stringify(startedBody));

  // 4. A refused crawl (source disabled) is relayed honestly.
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "not configured" }), { status: 503 })) as typeof fetch;
  const refused = await get({ authorization: `Bearer ${SECRET}` });
  check("a disabled crawl is reported upstream as refused", refused.status === 503, "503");

  // 5. A crawl that could not start must reach Vercel as a failure, not as a cheerful 202. The search API answers 502
  //    when its preflight read fails, and this route's only job is not to soften it: a cron whose failure looks like
  //    success is how a crawl stopped for eight days without anyone noticing.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "the crawl's database did not answer, so no crawl was started" }), {
      status: 502,
    })) as typeof fetch;
  const unreachable = await get({ authorization: `Bearer ${SECRET}` });
  const unreachableBody = (await unreachable.json()) as { ok: boolean; started: boolean; upstreamStatus: number };
  check(
    "a crawl that could not start is a failed cron, not a silent one",
    unreachable.status === 502 && !unreachableBody.ok && !unreachableBody.started && unreachableBody.upstreamStatus === 502,
    JSON.stringify(unreachableBody),
  );

  globalThis.fetch = realFetch;
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("SEARCH_API_URL", save.url);
  restore("SEARCH_API_CRON_TOKEN", save.token);
  restore("CRON_SECRET", save.secret);

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) FAILED: ${failures.join(", ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();
