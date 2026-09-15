import type { ApiError, CardId, RecContext, Result } from "@mtg/core/contract";
import { parseInput, type InputSchema } from "@mtg/core/schemas";
import { accountOwnedCardIds } from "./account-collection";
import { createAuthClient } from "./auth";
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

/** A failed Result as a JSON response, with the status code (and Retry-After) that fits the error. */
export function errorResponse(error: ApiError): Response {
  return Response.json({ ok: false, error } satisfies Result<never>, {
    status: STATUS[error.code] ?? 500,
    headers: error.retryAfterSec ? { "Retry-After": String(error.retryAfterSec) } : undefined,
  });
}

/** Requested limits are capped rather than rejected. */
export const capLimit = (value: number | undefined, max: number) => (value === undefined ? undefined : Math.min(value, max));

/** Card ids in the signed-in visitor's saved collection, or null when nobody is signed in. */
async function accountOwnedIds(): Promise<CardId[] | null> {
  const db = await createAuthClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return accountOwnedCardIds(db);
}

/**
 * The shared flow for POST /api/recs/*: count the request against the visitor's budget, validate the body, swap an
 * account collection for the signed-in user's owned card ids, run, and map failures to status codes.
 */
export async function handleRecsRequest<I extends { context: RecContext }, T>(
  request: Request,
  schema: InputSchema<I>,
  run: (db: PublicClient, input: I) => Promise<T>,
  unavailableMessage: string,
): Promise<Response> {
  const db = createPublicClient();
  const limited = await checkRateLimit(db, "recs", visitorKey(request.headers));
  if (limited) return errorResponse(limited);

  const input = parseInput(schema, await request.json().catch(() => null));
  if (!input.ok) return errorResponse(input.error);

  try {
    let data = input.data;
    if (data.context.ownership?.kind === "account") {
      const ownedCardIds = await accountOwnedIds();
      if (!ownedCardIds) return errorResponse({ code: "UNAUTHENTICATED", message: "Sign in to use your saved collection." });
      data = { ...data, context: { ...data.context, ownership: { kind: "session", catalogEpoch: "account", ownedCardIds } } };
    }
    return Response.json({ ok: true, data: await run(db, data) } satisfies Result<T>);
  } catch (err) {
    if (err instanceof NotFoundError) return errorResponse({ code: "NOT_FOUND", message: err.message });
    console.error(err);
    return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: unavailableMessage });
  }
}
