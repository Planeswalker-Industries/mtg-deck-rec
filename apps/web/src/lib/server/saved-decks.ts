import type { Bracket, CardId, DeckId, DeckInput, SavedDeckSummary } from "@mtg/core/contract";
import { fetchCardsById, toCardSummary } from "./cards";
import type { createAuthClient } from "./auth";

/** The cookie-backed client; row-level security scopes every read here to the signed-in user. */
type AuthClient = Awaited<ReturnType<typeof createAuthClient>>;

/** Why the database refused a deck write. The messages the user sees are chosen by the action. */
export type DeckRefusal = "NOT_SIGNED_IN" | "DECK_NOT_FOUND" | "DECK_NAME_REQUIRED" | "DECK_TOO_LARGE" | "TOO_MANY_DECKS";

const REFUSALS: readonly DeckRefusal[] = [
  "NOT_SIGNED_IN",
  "DECK_NOT_FOUND",
  "DECK_NAME_REQUIRED",
  "DECK_TOO_LARGE",
  "TOO_MANY_DECKS",
];

export class DeckRefused extends Error {
  constructor(readonly reason: DeckRefusal) {
    super(reason);
    this.name = "DeckRefused";
  }
}

/**
 * The save functions raise their reason as the exception message, so a refusal the user can act on is told apart
 * from a real fault here rather than by matching strings at the call site.
 */
function rethrow(message: string | undefined): never {
  const hit = REFUSALS.find((reason) => (message ?? "").includes(reason));
  if (hit) throw new DeckRefused(hit);
  throw new Error(message ?? "Deck write failed");
}

interface DeckRow {
  id: string;
  code: string;
  name: string;
  is_public: boolean;
  commander_1: number | null;
  commander_2: number | null;
  card_count: number;
  bracket: number | null;
  updated_at: string;
}

const DECK_COLUMNS = "id, code, name, is_public, commander_1, commander_2, card_count, bracket, updated_at" as const;

/**
 * The caller's decks, newest change first.
 *
 * Filtered by user_id on purpose, and NOT left to row-level security: the public_decks_read policy lets anyone read
 * a public deck, and new decks are public, so relying on RLS alone would list every public deck on the site here.
 */
export async function listMyDecks(db: AuthClient, userId: string): Promise<SavedDeckSummary[]> {
  const { data, error } = await db
    .from("decks")
    .select(DECK_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Loading decks failed: ${error.message}`);
  const rows = (data ?? []) as DeckRow[];

  const commanderIds = [...new Set(rows.flatMap((r) => [r.commander_1, r.commander_2].filter((id): id is number => id !== null)))];
  const cards = await fetchCardsById(db, commanderIds);

  return rows.map((row) => {
    const commanders = [row.commander_1, row.commander_2]
      .filter((id): id is number => id !== null)
      .flatMap((id) => {
        const card = cards.get(id);
        return card ? [toCardSummary(card)] : [];
      });
    return {
      id: row.id as DeckId,
      code: row.code,
      name: row.name,
      // A saved deck is not a corpus key, so it carries no deck counts of its own; the commander page has those.
      commanderKey: { id: null, slug: null, commanders, deckCount: 0, confidence: "none" },
      isPublic: row.is_public,
      cardCount: row.card_count,
      ...(row.bracket === null ? {} : { bracket: row.bracket as Bracket }),
      updatedAt: row.updated_at,
    };
  });
}

/** Flattens a DeckInput into the rows save_deck expects. Commanders keep their section so the database can find them. */
function deckRows(deck: DeckInput): { cardId: CardId; quantity: number; section: string }[] {
  return [
    ...deck.commanders.map((cardId) => ({ cardId, quantity: 1, section: "commander" })),
    // Anything outside the 99 (sideboard, maybeboard, companion) is not part of a saved Commander deck.
    ...deck.cards
      .filter((c) => c.section === "main" || c.section === "commander")
      .map((c) => ({ cardId: c.cardId, quantity: c.quantity, section: c.section === "commander" ? "commander" : "main" })),
  ];
}

export async function saveDeck(
  db: AuthClient,
  input: { deckId?: DeckId; name: string; deck: DeckInput; isPublic: boolean; bracket?: Bracket },
): Promise<DeckId> {
  const { data, error } = await db.rpc("save_deck", {
    p_deck_id: input.deckId ?? undefined,
    p_name: input.name,
    p_cards: deckRows(input.deck),
    p_bracket: input.bracket ?? undefined,
  });
  if (error) rethrow(error.message);
  const deckId = data as string;

  // Visibility is its own call: save_deck deliberately does not touch it, so re-saving a deck can never
  // republish one the owner has hidden.
  if (input.deckId === undefined && !input.isPublic) {
    await setDeckVisibility(db, deckId as DeckId, false);
  }
  return deckId as DeckId;
}

export async function renameDeck(db: AuthClient, deckId: DeckId, name: string): Promise<void> {
  const { error } = await db.rpc("rename_deck", { p_deck_id: deckId, p_name: name });
  if (error) rethrow(error.message);
}

export async function duplicateDeck(db: AuthClient, deckId: DeckId, name?: string): Promise<DeckId> {
  const { data, error } = await db.rpc("duplicate_deck", { p_deck_id: deckId, p_name: name ?? undefined });
  if (error) rethrow(error.message);
  return data as DeckId;
}

export async function setDeckVisibility(db: AuthClient, deckId: DeckId, isPublic: boolean): Promise<void> {
  const { error } = await db.rpc("set_deck_visibility", { p_deck_id: deckId, p_is_public: isPublic });
  if (error) rethrow(error.message);
}

/** Deletes through row-level security, which already limits it to the caller's own decks. */
export async function deleteDeck(db: AuthClient, deckId: DeckId): Promise<void> {
  const { error, count } = await db.from("decks").delete({ count: "exact" }).eq("id", deckId);
  if (error) throw new Error(`Deleting the deck failed: ${error.message}`);
  if (count === 0) throw new DeckRefused("DECK_NOT_FOUND");
}
