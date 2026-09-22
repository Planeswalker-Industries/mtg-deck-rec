import type { CardId, CollectionEntry, CollectionTotals, ResolvedCollectionRow, SourceApp } from "@mtg/core/contract";
import type { createAuthClient } from "./auth";

type AuthClient = Awaited<ReturnType<typeof createAuthClient>>;

/** The request has no signed-in user. */
export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

const REFUSALS = ["IMPORT_NOT_OPEN", "COLLECTION_TOO_LARGE", "CARD_NOT_FOUND", "NOT_SIGNED_IN"] as const;

/** The database refused a collection write: the import already finished or expired, or the collection is too large. */
export class CollectionRefused extends Error {
  constructor(readonly reason: (typeof REFUSALS)[number]) {
    super(`Collection write refused: ${reason}`);
  }
}

function writeFailed(action: string, message: string): Error {
  const reason = REFUSALS.find((r) => message.includes(r));
  if (reason === "NOT_SIGNED_IN") return new NotSignedInError();
  return reason ? new CollectionRefused(reason) : new Error(`${action} failed: ${message}`);
}

/**
 * Collections saved to an account. Every call goes through the visitor's own session: reads are limited to their rows
 * by row-level security, and writes go through database functions that only act on the signed-in user. Nothing here
 * takes a user id from the caller.
 */
export async function requireUserId(db: AuthClient): Promise<string> {
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new NotSignedInError();
  return userId;
}

export async function startImport(db: AuthClient, sourceApp: SourceApp, mode: "replace" | "merge"): Promise<string> {
  const { data, error } = await db.rpc("start_collection_import", { p_source_app: sourceApp, p_mode: mode });
  if (error) throw writeFailed("Starting a collection import", error.message);
  return String(data);
}

export async function saveRows(db: AuthClient, importId: string, rows: readonly ResolvedCollectionRow[]): Promise<void> {
  const payload = rows.map((row) => ({
    cardId: row.cardId,
    printingId: row.printingId,
    finish: row.finish,
    condition: row.condition,
    lang: row.lang,
    quantity: row.quantity,
  }));
  const { error } = await db.rpc("save_collection_rows", { p_import_id: Number(importId), p_rows: payload });
  if (error) throw writeFailed("Saving collection rows", error.message);
}

const toTotals = (value: unknown): CollectionTotals => {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    uniqueCards: typeof v.uniqueCards === "number" ? v.uniqueCards : 0,
    totalQuantity: typeof v.totalQuantity === "number" ? v.totalQuantity : 0,
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
  };
};

export async function commitImport(db: AuthClient, importId: string): Promise<CollectionTotals> {
  const { data, error } = await db.rpc("commit_collection_import", { p_import_id: Number(importId) });
  if (error) throw writeFailed("Finishing the collection import", error.message);
  return toTotals(data);
}

/** The signed-in user's collection totals, or null when they haven't saved one. */
export async function accountCollectionTotals(db: AuthClient): Promise<CollectionTotals | null> {
  const { data, error } = await db.rpc("my_collection_totals");
  if (error) throw new Error(`Loading collection totals failed: ${error.message}`);
  const totals = toTotals(data);
  return totals.uniqueCards > 0 ? totals : null;
}

/** The signed-in user's collection, one entry per card (copies summed across printings). */
export async function accountCollectionEntries(db: AuthClient): Promise<CollectionEntry[]> {
  const { data, error } = await db.rpc("my_collection_entries");
  if (error) throw new Error(`Loading the collection failed: ${error.message}`);
  return (data ?? []) as unknown as CollectionEntry[];
}

export async function accountOwnedCardIds(db: AuthClient): Promise<CardId[]> {
  const { data, error } = await db.rpc("my_owned_card_ids");
  if (error) throw new Error(`Loading owned cards failed: ${error.message}`);
  return ((data ?? []) as number[]).map((id) => id as CardId);
}

/** Sets a card's total copies in the caller's collection through set_collection_card_quantity; returns the new total. */
export async function setAccountCardQuantity(db: AuthClient, cardId: CardId, quantity: number): Promise<number> {
  const { data, error } = await db.rpc("set_collection_card_quantity", { p_card_id: cardId, p_quantity: quantity });
  if (error) throw writeFailed("Updating the collection", error.message);
  return data ?? 0;
}

export async function deleteAccountCollection(db: AuthClient): Promise<void> {
  // Row-level security limits the delete to the caller's own rows; PostgREST still requires a filter.
  const { error } = await db.from("collection_items").delete().gte("id", 0);
  if (error) throw new Error(`Deleting the collection failed: ${error.message}`);
}
