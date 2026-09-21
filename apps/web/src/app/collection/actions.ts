"use server";

import { headers } from "next/headers";
import type { ActionsApi, ApiError, CollectionEntry, CollectionTotals, Result } from "@mtg/core/contract";
import { parseInput, saveCollectionBatchInputSchema } from "@mtg/core/schemas";
import {
  accountCollectionEntries,
  accountCollectionTotals,
  CollectionRefused,
  commitImport,
  deleteAccountCollection,
  NotSignedInError,
  requireUserId,
  saveRows,
  startImport,
} from "@/lib/server/account-collection";
import { createAuthClient } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

const refusals: Record<CollectionRefused["reason"] | "NOT_SIGNED_IN", Result<never>> = {
  NOT_SIGNED_IN: failure("UNAUTHENTICATED", "Sign in to save your collection to an account."),
  IMPORT_NOT_OPEN: failure("VALIDATION", "That upload expired or already finished. Import the collection again."),
  COLLECTION_TOO_LARGE: failure("PAYLOAD_TOO_LARGE", "That collection is larger than an account can hold for now."),
};

function failed(err: unknown, message: string): Result<never> {
  if (err instanceof NotSignedInError) return refusals.NOT_SIGNED_IN;
  if (err instanceof CollectionRefused) return refusals[err.reason];
  console.error(err);
  return failure("UPSTREAM_UNAVAILABLE", message);
}

async function limited(): Promise<Result<never> | null> {
  const error = await checkRateLimit(createPublicClient(), "collection", visitorKey(await headers()));
  return error ? { ok: false, error } : null;
}

export interface AccountCollectionStatus {
  signedIn: boolean;
  /** null when the account has no saved collection. */
  totals: CollectionTotals | null;
}

/** Whether the visitor is signed in, and their saved collection's totals. Signed-out visitors cost no database calls. */
export async function getAccountCollectionAction(): Promise<Result<AccountCollectionStatus>> {
  try {
    const db = await createAuthClient();
    const { data } = await db.auth.getClaims();
    if (!data?.claims?.sub) return { ok: true, data: { signedIn: false, totals: null } };
    const blocked = await limited();
    if (blocked) return blocked;
    return { ok: true, data: { signedIn: true, totals: await accountCollectionTotals(db) } };
  } catch (err) {
    return failed(err, "Couldn't load your collection. Try again in a moment.");
  }
}

/**
 * Saves resolved collection rows to the signed-in user's account in batches of up to 2,000. The first call opens an
 * import; later calls pass its id back. Nothing changes until the call with `final: true`, which applies the import
 * and returns the collection totals.
 */
export async function saveCollectionBatchAction(
  input: Parameters<ActionsApi["saveCollectionBatch"]>[0],
): ReturnType<ActionsApi["saveCollectionBatch"]> {
  const parsed = parseInput(saveCollectionBatchInputSchema, input);
  if (!parsed.ok) return parsed;
  const { importId, sourceApp, mode, rows, final } = parsed.data;
  try {
    const blocked = await limited();
    if (blocked) return blocked;
    const db = await createAuthClient();
    await requireUserId(db);
    const id = importId ?? (await startImport(db, sourceApp, mode));
    if (rows.length > 0) await saveRows(db, id, rows);
    return { ok: true, data: { importId: id, totals: final ? await commitImport(db, id) : null } };
  } catch (err) {
    return failed(err, "Couldn't save your collection. Try again in a moment.");
  }
}

/** The signed-in user's saved collection, one entry per card, for the collection view. */
export async function getMyCollectionEntriesAction(): Promise<Result<CollectionEntry[]>> {
  try {
    const blocked = await limited();
    if (blocked) return blocked;
    const db = await createAuthClient();
    await requireUserId(db);
    return { ok: true, data: await accountCollectionEntries(db) };
  } catch (err) {
    return failed(err, "Couldn't load your collection. Try again in a moment.");
  }
}

/** Removes every card from the signed-in user's saved collection. */
export async function deleteCollectionAction(): Promise<Result<null>> {
  try {
    const blocked = await limited();
    if (blocked) return blocked;
    const db = await createAuthClient();
    await requireUserId(db);
    await deleteAccountCollection(db);
    return { ok: true, data: null };
  } catch (err) {
    return failed(err, "Couldn't clear your collection. Try again in a moment.");
  }
}
