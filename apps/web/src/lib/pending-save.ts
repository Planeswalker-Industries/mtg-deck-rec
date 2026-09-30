import type { Bracket, CardId, DeckInput } from "@mtg/core/contract";

/**
 * A deck a signed-out player asked to save, kept in this browser while they sign in. The deck tool picks it up when
 * they come back (`/deck?resume=save`) and saves it to the new account. Their collection needs no stash: a browser
 * collection moves to the account on its own at sign-in.
 */
export interface PendingSave {
  name: string;
  deck: DeckInput;
  bracket: Bracket | null;
  original?: DeckInput | undefined;
}

/** Where the deck tool is sent back to after signing in, to finish the save. */
export const RESUME_PARAM = "resume";
export const RESUME_SAVE = "save";

const STORAGE_KEY = "mtg-deck-rec:pending-save";
/** A sign-in abandoned for longer than this is not picked up later out of nowhere. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The sign-in page, sent back to the deck tool to finish the save. */
export const signInToSaveHref = () => `/sign-in?next=${encodeURIComponent(`/deck?${RESUME_PARAM}=${RESUME_SAVE}`)}`;

export function stashPendingSave(save: PendingSave): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...save, savedAt: Date.now() }));
  } catch {
    // Storage is blocked: the player signs in and saves again by hand.
  }
}

const isDeck = (value: unknown): value is DeckInput => {
  const v = value as Partial<DeckInput> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(v.commanders) &&
    v.commanders.every((id: unknown) => Number.isInteger(id)) &&
    Array.isArray(v.cards)
  );
};

/** The stashed save, once; it is cleared as it is read, so a reload can't save the deck twice. */
export function takePendingSave(): PendingSave | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    const v = JSON.parse(raw ?? "null") as (PendingSave & { savedAt?: number }) | null;
    if (!v || typeof v.name !== "string" || !isDeck(v.deck) || typeof v.savedAt !== "number") return null;
    if (Date.now() - v.savedAt > MAX_AGE_MS) return null;
    return {
      name: v.name,
      deck: { commanders: v.deck.commanders as CardId[], cards: v.deck.cards },
      bracket: v.bracket ?? null,
      ...(v.original && isDeck(v.original) ? { original: v.original } : {}),
    };
  } catch {
    return null;
  }
}
