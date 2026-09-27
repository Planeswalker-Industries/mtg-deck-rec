import type { Bracket } from "@mtg/core/contract";
import type { ImportedFrom } from "@/components/deck/use-deck-tool";

/** The deck from the player's last visit, kept in this browser only, so the tool opens where they left off. */
export interface SavedDeck {
  text: string;
  bracketOverride: Bracket | null;
  importedFrom: ImportedFrom | null;
}

interface StoredDeck extends SavedDeck {
  savedAt: number;
}

const STORAGE_KEY = "mtg-deck-rec:last-deck";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TEXT_CHARS = 20_000;

const isBracket = (value: unknown): value is Bracket => value === 1 || value === 2 || value === 3 || value === 4 || value === 5;

function readStored(): StoredDeck | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const imported = v.importedFrom;
    const importedOk =
      imported === null ||
      (typeof imported === "object" &&
        imported !== undefined &&
        ["archidekt", "moxfield"].includes((imported as Record<string, unknown>).source as string) &&
        typeof (imported as Record<string, unknown>).url === "string");
    const valid =
      typeof v.text === "string" &&
      v.text.length <= MAX_TEXT_CHARS &&
      typeof v.savedAt === "number" &&
      Date.now() - v.savedAt <= MAX_AGE_MS &&
      (v.bracketOverride === null || isBracket(v.bracketOverride)) &&
      importedOk;
    return valid ? (v as unknown as StoredDeck) : null;
  } catch {
    return null;
  }
}

export function loadSavedDeck(): SavedDeck | null {
  const stored = readStored();
  if (!stored) {
    clearSavedDeck();
    return null;
  }
  const { text, bracketOverride, importedFrom } = stored;
  return { text, bracketOverride, importedFrom };
}

export function saveDeck(deck: SavedDeck): void {
  if (deck.text.length > MAX_TEXT_CHARS) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...deck, savedAt: Date.now() } satisfies StoredDeck));
  } catch {
    // Storage is blocked or full. Remembering the deck is only a convenience.
  }
}

/** Keeps a bracket choice for the saved deck, if there is one. */
export function updateSavedDeck(changes: Partial<Pick<SavedDeck, "bracketOverride">>): void {
  const stored = loadSavedDeck();
  if (stored) saveDeck({ ...stored, ...changes });
}

export function clearSavedDeck(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is blocked; there's nothing saved to clear.
  }
}
