import type { ApiError, Result } from "@mtg/core/contract";

// Next refuses a Server Action body over its limit (1 MB by default) by throwing on the client, not with a Result;
// these are the words its error (or a proxy's 413) carries.
const BODY_LIMIT_ERROR = /body (exceeded|size)|too large|413/i;

export const offline: ApiError = {
  code: "UPSTREAM_UNAVAILABLE",
  message: "Couldn't reach the server. Check your connection and try again.",
};

const tooLarge: ApiError = {
  code: "PAYLOAD_TOO_LARGE",
  message: "Request too large. Try again.",
};

/**
 * Runs a Server Action call and turns a throw (a body over the limit, a dropped connection) into a Result error, so
 * no caller is left waiting on a promise that rejected.
 */
export async function callAction<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await call();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: BODY_LIMIT_ERROR.test(message) ? tooLarge : offline };
  }
}
