import type { CardId } from "@mtg/core/contract";
import { ownedCounts, shortfallRows, withShortfallAdded, type CollectionShortfall } from "@mtg/core/collection";
import { notifyCollectionChanged, type CollectionSource } from "@/components/collection/use-collection-source";
import { getApis } from "@/lib/api/client";
import { loadCollection, saveCollection, updateCollectionRows } from "@/lib/collection-store";

/** Copies per card in the visitor's collection, wherever it lives; empty when there is none (or it can't be read). */
export async function collectionCounts(source: CollectionSource): Promise<Map<CardId, number>> {
  if (source.kind === "browser") return ownedCounts(source.collection.rows);
  if (source.kind !== "account") return new Map();
  const r = await getApis().actions.getMyCollectionEntries();
  return r.ok ? new Map(r.data.map((entry) => [entry.cardId, entry.quantity])) : new Map();
}

/**
 * Adds a deck's missing copies to the visitor's collection. A browser collection is topped up where it is (signing in
 * moves it to the account); an account collection, or a signed-in visitor with none yet, gets them as a merged
 * import; a signed-out visitor with none starts a browser collection, which moves to the account when they sign in.
 * Throws with a message the save prompt can show.
 */
export async function addShortfallToCollection(
  source: CollectionSource,
  signedIn: boolean,
  shortfall: readonly CollectionShortfall[],
  names: ReadonlyMap<CardId, string>,
): Promise<void> {
  if (shortfall.length === 0) return;
  const stored = source.kind === "browser" ? await loadCollection() : null;
  if (stored) {
    await updateCollectionRows(stored, withShortfallAdded(stored.rows, shortfall));
  } else if (source.kind === "account" || signedIn) {
    const r = await getApis().actions.saveCollectionBatch({
      importId: null,
      sourceApp: "text",
      mode: "merge",
      rows: shortfallRows(shortfall),
      final: true,
    });
    if (!r.ok) throw new Error(r.error.message);
  } else {
    // A new browser collection needs the catalog's epoch, which only a resolve hands out; resolving by name also
    // proves the cards still exist.
    const r = await getApis().actions.resolveCollectionRows({
      rows: shortfall.map(({ cardId, missing }, i) => ({ rowNo: i + 1, name: names.get(cardId) ?? "", quantity: missing })),
    });
    if (!r.ok) throw new Error(r.error.message);
    await saveCollection({ catalogEpoch: r.data.catalogEpoch, rows: r.data.resolved, unmatched: [], unmatchedCount: r.data.unresolved.length });
  }
  notifyCollectionChanged();
}
