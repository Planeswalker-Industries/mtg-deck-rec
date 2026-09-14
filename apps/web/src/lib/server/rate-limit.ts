import type { ApiError } from "@mtg/core/contract";
import type { PublicClient } from "./supabase";

/** Request budgets per visitor. Limits and windows live in app_config.rate_limits. */
export type RateLimitBucket = "recs" | "deck" | "import" | "lookup";

/**
 * Counts one request against the visitor's budget for `bucket`. Returns a RATE_LIMITED error once the budget is spent,
 * otherwise null. When the check itself fails, the request goes through: a database hiccup shouldn't lock everyone out.
 */
export async function checkRateLimit(db: PublicClient, bucket: RateLimitBucket, visitor: string): Promise<ApiError | null> {
  const { data, error } = await db.rpc("hit_rate_limit", { p_bucket: bucket, p_visitor: visitor });
  if (error) {
    console.error(`Rate limit check for ${bucket} failed: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return {
    code: "RATE_LIMITED",
    message: `Too many requests. Try again in ${data} second${data === 1 ? "" : "s"}.`,
    retryAfterSec: data,
  };
}
