/**
 * Retries a database call that the API role's statement timeout cancelled.
 *
 * Why this helps rather than just costing time: the recommendation functions sweep a large part of `cards`, and on
 * the hosted free tier a cold `shared_buffers` makes that read from disk. The cancelled attempt still leaves the
 * pages it read in the buffer cache, so the next attempt has less to fetch. Measured against the hosted database
 * (Sol Ring, identity WUBRG, limit 120): first call cancelled at 3.0 s, second returned in 2.0 s, third in 0.27 s.
 *
 * Only a timeout is retried. Every other failure is returned as-is, because repeating it would just be slower.
 *
 * This is a mitigation, not the fix. Caching the swap pool somewhere that survives between serverless instances
 * would stop the cold query happening at all; see docs/roadmap/status.md.
 */

import type { PublicClient } from "./supabase";

/** Postgres cancels a statement that overruns statement_timeout with SQLSTATE 57014. */
const STATEMENT_TIMEOUT = "57014";

/** Three attempts total. Each one can burn the full statement timeout, so more would risk the function's own limit. */
const MAX_ATTEMPTS = 3;

interface Failure {
  code?: string | null;
  message?: string | null;
}

export function isStatementTimeout(error: Failure | null | undefined): boolean {
  if (!error) return false;
  // PostgREST forwards SQLSTATE in `code`, but a timeout surfaced through other layers only has the message.
  return error.code === STATEMENT_TIMEOUT || (error.message ?? "").includes("canceling statement due to statement timeout");
}

/**
 * Runs `call` until it succeeds, fails for a reason other than a timeout, or runs out of attempts. Returns the last
 * result either way, so callers keep their existing error handling.
 */
export async function retryOnTimeout<T extends { error: Failure | null }>(
  label: string,
  // PromiseLike, not Promise: Supabase's query builder is a thenable, and typing it as a Promise makes
  // inference fall back to the constraint, which drops `data` from the result.
  call: () => PromiseLike<T>,
): Promise<T> {
  let result = await call();
  for (let attempt = 2; attempt <= MAX_ATTEMPTS && isStatementTimeout(result.error); attempt++) {
    // No backoff: nothing is going to settle by waiting, and the caller is holding a request open.
    console.warn(`${label}: statement timed out, retrying (attempt ${attempt} of ${MAX_ATTEMPTS})`);
    result = await call();
  }
  return result;
}

/** What was being asked for, so the aggregate says which cards and commanders are slow. */
export interface TimeoutShape {
  fn: "swap" | "add";
  /** The swap target. Omitted for cards to add, which has no single target. */
  targetCardId?: number;
  commanderIds?: readonly number[];
  identityMask?: number;
  ownedOnly?: boolean;
}

/**
 * Records a query that ran out of retries, so the slow ones can be found rather than guessed at.
 *
 * Deliberately fire-and-forget and silent: the request that got here is already slow, and bookkeeping must never
 * turn it into a failure. The database function swallows its own errors too.
 */
export function recordRecTimeout(db: PublicClient, shape: TimeoutShape): void {
  void db
    .rpc("log_rec_timeout", {
      p_fn: shape.fn,
      p_target_card_id: shape.targetCardId,
      p_commander_ids: shape.commanderIds ? [...shape.commanderIds] : [],
      p_identity_mask: shape.identityMask ?? 0,
      p_owned_only: shape.ownedOnly ?? false,
    })
    .then(({ error }) => {
      if (error) console.warn(`Recording a ${shape.fn} timeout failed: ${error.message}`);
    });
}
