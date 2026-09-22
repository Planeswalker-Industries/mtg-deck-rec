"use server";

import { headers } from "next/headers";
import type { ActionsApi, ApiError, CardId, CollectionEntry, CollectionTotals, Result } from "@mtg/core/contract";
import { collectionLink, type CollectionLinkSource } from "@mtg/core/parse";
import { parseInput, saveCollectionBatchInputSchema, setCollectionCardQuantityInputSchema } from "@mtg/core/schemas";
import { z } from "zod";
import {
  accountCollectionEntries,
  accountCollectionTotals,
  CollectionRefused,
  commitImport,
  deleteAccountCollection,
  NotSignedInError,
  requireUserId,
  saveRows,
  setAccountCardQuantity,
  startImport,
} from "@/lib/server/account-collection";
import { createAuthClient } from "@/lib/server/auth";
import { ARCHIDEKT_MAX_PAGE, fetchArchidektCollection, type CollectionLinkChunk } from "@/lib/server/collection-link";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

const refusals: Record<CollectionRefused["reason"] | "NOT_SIGNED_IN", Result<never>> = {
  NOT_SIGNED_IN: failure("UNAUTHENTICATED", "Sign in to save your collection to an account."),
  IMPORT_NOT_OPEN: failure("VALIDATION", "That upload expired or already finished. Import the collection again."),
  COLLECTION_TOO_LARGE: failure("PAYLOAD_TOO_LARGE", "That collection is larger than an account can hold for now."),
  CARD_NOT_FOUND: failure("NOT_FOUND", "That card isn't in the catalog any more."),
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

/** Sets how many copies of a card the signed-in user's collection holds; 0 removes it. */
export async function setCollectionCardQuantityAction(input: unknown): Promise<Result<{ cardId: CardId; quantity: number }>> {
  try {
    const parsed = parseInput(setCollectionCardQuantityInputSchema, input);
    if (!parsed.ok) return parsed;
    const blocked = await limited();
    if (blocked) return blocked;
    const db = await createAuthClient();
    await requireUserId(db);
    const quantity = await setAccountCardQuantity(db, parsed.data.cardId, parsed.data.quantity);
    return { ok: true, data: { cardId: parsed.data.cardId, quantity } };
  } catch (err) {
    return failed(err, "Couldn't update your collection. Try again in a moment.");
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

/** Longest link the import box will send. Real collection links are well under a hundred characters. */
const MAX_LINK_CHARS = 2_048;

const importLinkInputSchema = z.object({
  url: z.string().trim().min(1, "Paste a link to a collection.").max(MAX_LINK_CHARS, "That link is too long."),
  page: z.int().min(1).max(ARCHIDEKT_MAX_PAGE),
});

/** What to do instead, for apps whose links can't be read. Each is the app's own export path. */
const EXPORT_INSTEAD: Record<Exclude<CollectionLinkSource, "archidekt">, string> = {
  manabox: "ManaBox links can't be imported yet. In ManaBox, open the menu at the top right of the Collection tab, export a CSV, and upload the file here.",
  moxfield: "Moxfield links can't be imported, because Moxfield's API needs an account. In Moxfield, export the collection as CSV and upload the file here.",
  tcgplayer: "TCGplayer links can't be imported yet. Export the collection from the TCGplayer app and upload the file here.",
};

export type CollectionLinkImport = CollectionLinkChunk & { source: "archidekt"; sourceUrl: string };

/**
 * A public collection from a pasted share link, as CSV for the same parser an upload goes through. Only Archidekt
 * links can be read; the others say how to export from that app instead.
 *
 * A large collection comes in several calls: each returns up to four export pages and the page to ask for next, and
 * the import calls again until `nextPage` is null. Every call counts against the `import` rate limit.
 */
export async function importCollectionFromLinkAction(input: { url: string; page: number }): Promise<Result<CollectionLinkImport>> {
  const parsed = importLinkInputSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION", parsed.error.issues[0]?.message ?? "That link can't be imported.");
  const { url, page } = parsed.data;

  const link = collectionLink(url);
  if (!link) return failure("VALIDATION", "Paste a link to a public Archidekt collection, like https://archidekt.com/collection/v2/123456.");
  if (link.source !== "archidekt") return failure("UPSTREAM_NOT_AUTHORIZED", EXPORT_INSTEAD[link.source]);

  try {
    const db = createPublicClient();
    const error = await checkRateLimit(db, "import", visitorKey(await headers()));
    if (error) return { ok: false, error };
    const result = await fetchArchidektCollection(db, link.collectionId, page);
    if (!result.ok) return result;
    return { ok: true, data: { ...result.data, source: "archidekt", sourceUrl: `https://archidekt.com/collection/v2/${link.collectionId}` } };
  } catch (err) {
    return failed(err, "Couldn't load that Archidekt collection. Try again in a moment.");
  }
}
