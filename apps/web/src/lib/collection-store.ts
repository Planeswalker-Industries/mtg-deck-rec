import type { CardId, ResolvedCollectionRow, UnresolvedCollectionRow } from "@mtg/core/contract";

/**
 * A collection imported without an account, kept in this browser's IndexedDB for 7 days (localStorage can't hold tens
 * of thousands of rows). Nothing is sent to the server except card ids when the deck tool asks for owned-only
 * suggestions.
 */
export interface UnmatchedLine {
  rowNo: number;
  name: string | null;
  reason: UnresolvedCollectionRow["reason"];
}

export interface StoredCollection {
  version: 1;
  /** Catalog version the ids were matched against; a newer catalog can re-match them. */
  catalogEpoch: string;
  importedAt: number;
  expiresAt: number;
  rows: ResolvedCollectionRow[];
  /** The first unmatched lines, for showing the user what didn't import. */
  unmatched: UnmatchedLine[];
  unmatchedCount: number;
}

const DB_NAME = "mtg-deck-rec";
const STORE = "collection";
const KEY = "current";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_UNMATCHED_KEPT = 500;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const isStoredCollection = (value: unknown): value is StoredCollection => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.catalogEpoch === "string" &&
    typeof v.importedAt === "number" &&
    typeof v.expiresAt === "number" &&
    Array.isArray(v.rows) &&
    Array.isArray(v.unmatched) &&
    typeof v.unmatchedCount === "number"
  );
};

/** The saved collection, or null when there's none, it expired, or this browser won't open IndexedDB. */
export async function loadCollection(): Promise<StoredCollection | null> {
  try {
    const value = await inStore<unknown>("readonly", (store) => store.get(KEY));
    if (!isStoredCollection(value)) return null;
    if (value.expiresAt <= Date.now()) {
      await clearCollection();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** Replaces the saved collection. Throws when the browser won't store it (private browsing can block IndexedDB). */
export async function saveCollection(
  collection: Pick<StoredCollection, "catalogEpoch" | "rows" | "unmatched" | "unmatchedCount">,
): Promise<StoredCollection> {
  const now = Date.now();
  const stored: StoredCollection = { version: 1, importedAt: now, expiresAt: now + TTL_MS, ...collection };
  await inStore("readwrite", (store) => store.put(stored, KEY));
  return stored;
}

/**
 * Writes hand edits to the saved collection's rows, keeping when it was imported and when it expires: editing isn't
 * a new import. Throws when the browser won't store it.
 */
export async function updateCollectionRows(collection: StoredCollection, rows: ResolvedCollectionRow[]): Promise<StoredCollection> {
  const stored: StoredCollection = { ...collection, rows };
  await inStore("readwrite", (store) => store.put(stored, KEY));
  return stored;
}

export async function clearCollection(): Promise<void> {
  try {
    await inStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or the browser blocks IndexedDB.
  }
}

export function collectionTotals(collection: StoredCollection): { uniqueCards: number; totalQuantity: number } {
  return {
    uniqueCards: new Set(collection.rows.map((r) => r.cardId)).size,
    totalQuantity: collection.rows.reduce((sum, r) => sum + r.quantity, 0),
  };
}

/** Distinct cards owned, whatever the printing, for owned-only recommendations. */
export function ownedCardIds(collection: StoredCollection): CardId[] {
  return [...new Set(collection.rows.map((r) => r.cardId))];
}
