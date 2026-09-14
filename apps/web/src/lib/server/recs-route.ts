import type { ApiError, RecContext, Result } from "@mtg/core/contract";
import { parseInput, type InputSchema } from "@mtg/core/schemas";
import { checkRateLimit } from "./rate-limit";
import { NotFoundError } from "./recs";
import { createPublicClient, type PublicClient } from "./supabase";
import { visitorKey } from "./visitor";

const STATUS: Partial<Record<ApiError["code"], number>> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 503,
};

function failure(error: ApiError): Response {
  return Response.json({ ok: false, error } satisfies Result<never>, {
    status: STATUS[error.code] ?? 500,
    headers: error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : undefined,
  });
}

/** Requested limits are capped rather than rejected. */
export const capLimit = (value: number | undefined, max: number) => (value === undefined ? undefined : Math.min(value, max));

/**
 * The shared flow for POST /api/recs/*: count the request against the visitor's budget, validate the body, refuse
 * account collections (there's no sign-in yet), run, and map failures to status codes.
 */
export async function handleRecsRequest<I extends { context: RecContext }, T>(
  request: Request,
  schema: InputSchema<I>,
  run: (db: PublicClient, input: I) => Promise<T>,
  unavailableMessage: string,
): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "recs", visitorKey(request.headers));
  if (limited) return failure(limited);

  const input = parseInput(schema, await request.json().catch(() => null));
  if (!input.ok) return failure(input.error);
  if (input.data.context.ownership?.kind === "account") {
    return failure({ code: "UNAUTHENTICATED", message: "Sign in to use your saved collection." });
  }

  try {
    return Response.json({ ok: true, data: await run(db, input.data) } satisfies Result<T>);
  } catch (err) {
    if (err instanceof NotFoundError) return failure({ code: "NOT_FOUND", message: err.message });
    console.error(err);
    return failure({ code: "UPSTREAM_UNAVAILABLE", message: unavailableMessage });
  }
}
