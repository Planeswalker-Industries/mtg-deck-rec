/**
 * Whether the deck tool has already offered a signed-in player with no collection to import one. The offer is worth
 * making once: after that the links on the page say the same thing without interrupting anyone.
 */
const STORAGE_KEY = "mtg-deck-rec:collection-offered";

export function collectionOffered(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberCollectionOffered(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage is blocked; the offer will come back on the next visit.
  }
}
