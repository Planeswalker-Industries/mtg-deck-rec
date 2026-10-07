import { sessionCopies, type CollectionCopies } from "@mtg/core/collection";
import type { ApiError, CardId, DeckId, RecContext, Result } from "@mtg/core/contract";
import { parseInput, type InputSchema } from "@mtg/core/schemas";
import { accountCollectionCopies, accountOwnedCardIds } from "./account-collection";
import { createAuthClient } from "./auth";
import { checkRateLimit, knownRateLimit } from "./rate-limit";
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
export async function accountOwnedIds(): Promise<CardId[] | null> {
  const db = await createAuthClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return accountOwnedCardIds(db);
}

/** The signed-in visitor's copies and built decks, or null when nobody is signed in. */
async function accountCopies(deckId: DeckId | undefined): Promise<CollectionCopies | null> {
  const db = await createAuthClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return accountCollectionCopies(db, deckId);
}

/**
 * The shared flow for POST /api/recs/*: count the request against the visitor's budget, validate the body, read the
 * collection (a session's from the request, an account's copies and built decks from the database), run, and map
 * failures to status codes.
 *
 * The budget check goes out together with the request's own reads rather than ahead of them, so it costs no round trip
 * of its own (T055). A request over budget throws away what it read, and from then on this instance answers that
 * visitor without the database until the budget renews (`knownRateLimit`). Invalid bodies still count.
 */
export async function handleRecsRequest<I extends { context: RecContext }, T>(
  request: Request,
  schema: InputSchema<I>,
  run: (db: PublicClient, input: I, collection: CollectionCopies | null) => Promise<T>,
  unavailableMessage: string,
): Promise<Response> {
  const visitor = visitorKey(request.headers);
  const known = knownRateLimit("recs", visitor);
  if (known) return errorResponse(known);
  const db = createPublicClient();
  const limit = checkRateLimit(db, "recs", visitor);

  const input = parseInput(schema, await request.json().catch(() => null));
  if (!input.ok) return errorResponse((await limit) ?? input.error);

  // Never rejects: every outcome is a response, so the budget check decides alone whether it is sent.
  const answer = async (): Promise<Response> => {
    try {
      const { ownership } = input.data.context;
      let collection = sessionCopies(ownership);
      if (ownership?.kind === "account") {
        // The pool or the ranking depends on the collection, so an account collection is read first.
        collection = await accountCopies(ownership.deckId);
        if (!collection) return errorResponse({ code: "UNAUTHENTICATED", message: "Sign in to use your saved collection." });
      }
      return Response.json({ ok: true, data: await run(db, input.data, collection) } satisfies Result<T>);
    } catch (err) {
      if (err instanceof NotFoundError) return errorResponse({ code: "NOT_FOUND", message: err.message });
      console.error(err);
      return errorResponse({ code: "UPSTREAM_UNAVAILABLE", message: unavailableMessage });
    }
  };
  const [limited, response] = await Promise.all([limit, answer()]);
  return limited ? errorResponse(limited) : response;
}
