import type { ApiError } from "@mtg/core/contract";
import { logError } from "./error-log";
import type { PublicClient } from "./supabase";

/** Request budgets per visitor. Limits and windows live in app_config.rate_limits. */
export type RateLimitBucket =
  | "recs"
  | "fix"
  | "deck"
  | "deck_write"
  | "import"
  | "lookup"
  | "collection"
  | "shared_collection"
  | "auth"
  | "vote"
  | "events"
  | "search"
  | "feedback"
  | "client_error"
  | "admin";

/** How many spent budgets one server instance remembers; past it, the oldest is forgotten (and asks the database again). */
const MAX_REMEMBERED_LIMITS = 10_000;
const MS_PER_SECOND = 1_000;

/** When each spent budget (bucket and visitor) renews, as this instance last heard from the database. */
const limitedUntil = new Map<string, number>();

function rateLimited(retryAfterSec: number): ApiError {
  return {
    code: "RATE_LIMITED",
    message: `Too many requests. Try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`,
    retryAfterSec,
  };
}

/**
 * A budget this instance already saw run out, while its window lasts: answered without a database call, so a visitor
 * past their budget costs nothing more until it renews.
 */
export function knownRateLimit(bucket: RateLimitBucket, visitor: string): ApiError | null {
  const key = `${bucket}:${visitor}`;
  const until = limitedUntil.get(key);
  if (until === undefined) return null;
  const left = until - Date.now();
  if (left <= 0) {
    limitedUntil.delete(key);
    return null;
  }
  return rateLimited(Math.ceil(left / MS_PER_SECOND));
}

/**
 * Counts one request against the visitor's budget for `bucket`. Returns a RATE_LIMITED error once the budget is spent,
 * otherwise null. When the check itself fails, the request goes through: a database hiccup shouldn't lock everyone out.
 */
export async function checkRateLimit(db: PublicClient, bucket: RateLimitBucket, visitor: string): Promise<ApiError | null> {
  const known = knownRateLimit(bucket, visitor);
  if (known) return known;
  const { data, error } = await db.rpc("hit_rate_limit", { p_bucket: bucket, p_visitor: visitor });
  if (error) {
    logError({ area: `rateLimit.${bucket}`, error, context: { bucket } });
    return null;
  }
  if (!data) return null;
  const key = `${bucket}:${visitor}`;
  limitedUntil.delete(key);
  if (limitedUntil.size >= MAX_REMEMBERED_LIMITS) {
    const oldest = limitedUntil.keys().next().value;
    if (oldest !== undefined) limitedUntil.delete(oldest);
  }
  limitedUntil.set(key, Date.now() + data * MS_PER_SECOND);
  const refusal = rateLimited(data);
  // Once per spent budget and instance: the refusals after it come from memory above and log nothing, so a visitor
  // hammering the site can't turn each refused request into a ticket write. A browser's own reports are left out:
  // their budget running out is the flood guard working, and logging it would be one more write per flood.
  if (bucket !== "client_error") {
    logError({ area: `rateLimit.${bucket}`, error: refusal.message, level: "warning", code: refusal.code, shown: refusal.message, context: { bucket, retryAfterSec: data } });
  }
  return refusal;
}
