import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { headers } from "next/headers";
import { after } from "next/server";
import {
  ERROR_AREA_PATTERN,
  MAX_ERROR_AREA_CHARS,
  MAX_ERROR_CODE_CHARS,
  MAX_ERROR_CONTEXT_VALUE_CHARS,
  MAX_ERROR_MESSAGE_CHARS,
  boundContext,
  describeError,
  errorFingerprintSource,
  fitErrorDetail,
  redactPersonalData,
  sitePath,
  truncate,
  type DescribedError,
  type ErrorLevel,
  type ErrorSource,
} from "@mtg/core/errors";
import type { Database } from "./database.types";
import { createAdminClient } from "./supabase-admin";

/**
 * Error tickets (supabase/migrations/20261125000100_error_tickets.sql): every failure the site hits opens or joins a
 * ticket at /admin/errors, with what happened, where, to whom and when. Vercel's logs still get the console line, but
 * they age out within a day or so, and they say nothing about which account it was.
 *
 * `logError` is the one call a failure needs. It never throws and never makes the visitor wait: the write runs after
 * the response (`after`), or straight away where there is no request (a script). A failed write only reaches the
 * console, so logging can't loop on itself.
 */

/** A deployment's commit, cut to the length GitHub links by. */
const COMMIT_SHA_CHARS = 12;
/** How far into the user agent a ticket keeps: enough for the browser, its version and the platform. */
const USER_AGENT_CHARS = 300;
const COOKIE_PAIR_SEPARATOR = /;\s*/;
/** One write per kind of warning per instance per minute: enough to see it's still happening, light on the database. */
const WARNING_WINDOW_MS = 60_000;
/** Kinds of warning one instance tracks at once; past it the oldest is forgotten (and may write again early). */
const MAX_THROTTLED_WARNINGS = 1_000;
/** How long the ticket waits for the request's facts and the signed-in account before writing without them. */
const REQUEST_FACTS_TIMEOUT_MS = 1_000;

const warningWindows = new Map<string, { until: number; skipped: number }>();

export interface FailureReport {
  /** What was running, as a dotted name: 'collection.saveBatch', 'recs.swap', 'shareImport.archidekt'. */
  area: string;
  /** What was thrown or returned. Anything goes: an Error, a Supabase error object, a string. */
  error: unknown;
  /** 'warning' for a refusal that isn't a bug (a rate limit, a blocked source) but still stopped someone. Default 'error'. */
  level?: ErrorLevel;
  /** The API error code the visitor got, when the failure became one. Part of the fingerprint. */
  code?: string;
  /** The message the visitor saw. */
  shown?: string;
  /** A few facts about what the code was doing: sizes, ids, steps. Never what the visitor typed or pasted. */
  context?: Record<string, unknown>;
}

/** Facts about the request a failure happened in, gathered where they can be read. */
export interface RequestFacts {
  pagePath?: string;
  userId?: string;
  method?: string;
  /** The route file, for a failure the framework caught: /app/deck/page, /api/recs/swap/route. */
  route?: string;
  /** 'render', 'route', 'action' or 'proxy', for a failure the framework caught. */
  routeType?: string;
  userAgent?: string;
  /** Vercel's id for the request, which finds it in the platform's own logs while they last. */
  requestId?: string;
  /** Set on a Server Action call: which action it was. */
  actionId?: string;
  /** The request's Cookie header, read for the signed-in account only when the ticket is written (after the response). */
  cookieHeader?: string;
}

/**
 * Records a failure as an error ticket, after the response. Also writes it to the console. Never throws. `facts`
 * is for callers that hold the request themselves (the proxy); everyone else's are read from the request.
 */
export function logError(report: FailureReport, facts?: RequestFacts): void {
  writeToConsole(report);
  const write = () => recordFailure(report, "server", facts);
  try {
    after(write);
  } catch {
    // Outside a request (a script, a build step) there is no `after`: write now, still without throwing.
    void write();
  }
}

function writeToConsole(report: FailureReport): void {
  const line = `[${report.area}]${report.code ? ` ${report.code}` : ""}`;
  if (report.level === "warning") console.warn(line, report.error);
  else console.error(line, report.error);
}

/**
 * Writes one failure to its ticket and returns the ticket's id, or null when it couldn't be written (no secret key
 * configured, the database down). `facts` stands in for the request's own, where the caller has better ones (the
 * framework's hook, a browser's report).
 */
export async function recordFailure(
  report: FailureReport,
  source: ErrorSource,
  facts?: RequestFacts,
  /** A browser's report brings its own error, already written down; the server adds nothing to it but bounds. */
  described?: DescribedError,
): Promise<number | null> {
  try {
    const error = described ?? describeError(report.error);
    const area = cleanArea(report.area);
    const code = report.code ? truncate(report.code, MAX_ERROR_CODE_CHARS) : undefined;
    const message = truncate(redactPersonalData(error.message.trim()) || "(no message)", MAX_ERROR_MESSAGE_CHARS);
    const fingerprint = createHash("sha256").update(errorFingerprintSource({ source, area, code, message })).digest("hex");
    const level = report.level ?? "error";
    const skipped = level === "warning" ? throttleWarning(fingerprint) : 0;
    if (skipped === null) return null;

    const request = facts ?? (await withTimeout(currentRequestFacts(), REQUEST_FACTS_TIMEOUT_MS, {}));
    const userId = request.userId ?? (await withTimeout(userIdFromCookies(request.cookieHeader), REQUEST_FACTS_TIMEOUT_MS, undefined));
    const detail = redactDetail({
      error,
      ...(report.shown ? { shown: truncate(report.shown, MAX_ERROR_CONTEXT_VALUE_CHARS) } : {}),
      ...(boundContext(report.context) ? { context: boundContext(report.context) } : {}),
      request: withoutUndefined({
        method: request.method,
        route: request.route,
        routeType: request.routeType,
        actionId: request.actionId,
        requestId: request.requestId,
        userAgent: request.userAgent ? truncate(request.userAgent, USER_AGENT_CHARS) : undefined,
        signedIn: userId !== undefined,
      }),
      deployment: deploymentFacts(),
    });

    const { data, error: rpcError } = await createAdminClient().rpc("log_error_event", {
      p_fingerprint: fingerprint,
      p_level: level,
      p_source: source,
      p_area: area,
      p_message: message,
      ...(code ? { p_code: code } : {}),
      ...(request.pagePath ? { p_page_path: request.pagePath } : {}),
      ...(userId ? { p_user_id: userId } : {}),
      p_detail: detail as Database["public"]["Functions"]["log_error_event"]["Args"]["p_detail"],
      ...(skipped > 0 ? { p_skipped: skipped } : {}),
    });
    if (rpcError) throw new Error(rpcError.message);
    return Number(data);
  } catch (err) {
    noteUnrecorded(err);
    return null;
  }
}

/**
 * A warning repeats in bulk when something it depends on is down (every search while the index is out), so each
 * instance writes one kind of warning at most once a window and counts the rest: null means skip this one, a number is
 * how many were skipped since the last write (which the ticket adds to its count). Errors are always written.
 */
function throttleWarning(fingerprint: string): number | null {
  const now = Date.now();
  const seen = warningWindows.get(fingerprint);
  if (seen && now < seen.until) {
    seen.skipped += 1;
    return null;
  }
  if (!seen && warningWindows.size >= MAX_THROTTLED_WARNINGS) {
    const oldest = warningWindows.keys().next().value;
    if (oldest !== undefined) warningWindows.delete(oldest);
  }
  warningWindows.delete(fingerprint);
  warningWindows.set(fingerprint, { until: now + WARNING_WINDOW_MS, skipped: 0 });
  return seen?.skipped ?? 0;
}

/** A promise's value, or `fallback` once `ms` pass. A prerender's request read waits forever instead of failing. */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Says once per server instance that tickets aren't being written, rather than once per failure. */
let warnedUnrecorded = false;
function noteUnrecorded(err: unknown): void {
  if (warnedUnrecorded) return;
  warnedUnrecorded = true;
  console.error("Writing an error ticket failed; failures reach the console only until this instance restarts:", err);
}

/** The detail with every email address taken out (stack, causes, context and all), then fitted to its size limit. */
function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  return fitErrorDetail(JSON.parse(redactPersonalData(JSON.stringify(detail))) as Record<string, unknown>);
}

function cleanArea(area: string): string {
  const cleaned = truncate(area.trim(), MAX_ERROR_AREA_CHARS).replace(/[^A-Za-z0-9_.:/[\]-]/g, "-");
  return cleaned && ERROR_AREA_PATTERN.test(cleaned) ? cleaned : "unknown";
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function deploymentFacts() {
  return withoutUndefined({
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, COMMIT_SHA_CHARS),
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    region: process.env.VERCEL_REGION,
  });
}

/**
 * The current request's facts, where they can be read (Route Handlers and Server Actions; not a Server Component's
 * `after`, nor a script). The page is the referring page for an action or an API call, without its query string: the
 * deck tool's state never rides along.
 */
async function currentRequestFacts(): Promise<RequestFacts> {
  try {
    const h = await headers();
    return {
      pagePath: sitePath(h.get("referer")),
      userAgent: h.get("user-agent") ?? undefined,
      requestId: h.get("x-vercel-id") ?? undefined,
      actionId: h.get("next-action") ?? undefined,
      cookieHeader: h.get("cookie") ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The signed-in account in a request's cookies, or undefined. Reads the session without refreshing it (it never sets
 * cookies), and a session that doesn't verify counts as signed out.
 */
export async function userIdFromCookies(cookieHeader: string | null | undefined): Promise<string | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !cookieHeader) return undefined;
  const cookies = cookieHeader
    .split(COOKIE_PAIR_SEPARATOR)
    .map((pair) => {
      const at = pair.indexOf("=");
      return at > 0 ? { name: pair.slice(0, at), value: decodeURIComponentSafe(pair.slice(at + 1)) } : null;
    })
    .filter((c): c is { name: string; value: string } => c !== null);
  try {
    const client = createServerClient<Database>(url, key, { cookies: { getAll: () => cookies, setAll: () => {} } });
    const { data } = await client.auth.getClaims();
    return typeof data?.claims?.sub === "string" ? data.claims.sub : undefined;
  } catch {
    return undefined;
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
