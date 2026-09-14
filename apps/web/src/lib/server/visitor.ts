import { createHash } from "node:crypto";

/**
 * Identifies a visitor for rate limits and deck lookups without storing their address: a salted hash of the first
 * forwarded address (set by the hosting proxy). Visitors behind one address share a key.
 */
export function visitorKey(headers: { get(name: string): string | null }): string {
  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("RATE_LIMIT_SALT is not set.");
  const address = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${salt ?? "development"}:${address}`).digest("base64url");
}
