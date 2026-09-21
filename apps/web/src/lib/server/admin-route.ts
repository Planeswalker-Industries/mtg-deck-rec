import type { ApiError, Result } from "@mtg/core/contract";
import { AdminError, requirePlatformAdmin, type AdminSession } from "./admin";
import { checkRateLimit } from "./rate-limit";
import { createPublicClient } from "./supabase";
import { visitorKey } from "./visitor";

const STATUS: Partial<Record<ApiError["code"], number>> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
};

/**
 * The opening of every /api/admin handler: count the request against the visitor's budget, then establish that the
 * caller is a platform admin. The budget is counted first, so an attacker probing the admin routes pays for it
 * whether or not they get in.
 */
export async function beginAdminRequest(request: Request): Promise<AdminSession | { error: ApiError }> {
  const limited = await checkRateLimit(createPublicClient(), "admin", visitorKey(request.headers));
  if (limited) return { error: limited };
  return requirePlatformAdmin();
}

/**
 * A failure as JSON, with the status that fits. Anything that isn't an ApiError or an AdminError is logged and
 * reported as a generic failure: an admin route must not become a place where internal errors are read back.
 */
export function adminErrorResponse(failure: ApiError | unknown): Response {
  const error = toApiError(failure);
  return Response.json({ ok: false, error } satisfies Result<never>, {
    status: STATUS[error.code] ?? 500,
    headers: {
      "Cache-Control": "no-store",
      ...(error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : {}),
    },
  });
}

function toApiError(failure: ApiError | unknown): ApiError {
  if (failure instanceof AdminError) return { code: failure.code, message: failure.message };
  if (isApiError(failure)) return failure;
  console.error(failure);
  return { code: "UPSTREAM_UNAVAILABLE", message: "That didn't work. Try again in a moment." };
}

/**
 * A path segment that is a user id, or null. Checked before it reaches Postgres: a malformed uuid there is an
 * invalid_text_representation error, which would surface as "try again in a moment" for something that will never
 * work. There is no such user, so that is what it says.
 */
export const asUserId = (id: string): string | null => (UUID.test(id) ? id : null);

/** The same check for a tag id: Tagger tags are keyed by uuid too. */
export const asTagId = asUserId;

/** A path segment that is a sync run id (a positive integer), or null. */
export const asRunId = (id: string): number | null => (/^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isApiError = (value: unknown): value is ApiError =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;
