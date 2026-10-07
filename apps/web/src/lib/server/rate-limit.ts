import type { ApiError } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

/** Request budgets per visitor. Limits and windows live in app_config.rate_limits. */
export type RateLimitBucket =
  | "recs"
  | "deck"
  | "deck_write"
  | "import"
  | "lookup"
  | "collection"
  | "auth"
  | "vote"
  | "events"
  | "search"
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
    console.error(`Rate limit check for ${bucket} failed: ${error.message}`);
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
  return rateLimited(data);
}
