import type { Bracket, CardCategory, CardSummary, DeckId } from "@mtg/core/contract";
import { cardCategory } from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary } from "./cards";
import type { PublicClient } from "./supabase";

export interface DeckPageCard {
  card: CardSummary;
  quantity: number;
  category: CardCategory;
}

export interface DeckPageData {
  id: DeckId;
  name: string;
  isPublic: boolean;
  isOwner: boolean;
  commanders: CardSummary[];
  /** The 99, grouped by card type in the order a decklist is usually written. */
  groups: { category: CardCategory; cards: DeckPageCard[] }[];
  cardCount: number;
  bracket: Bracket | null;
  updatedAt: string;
}

const CATEGORY_ORDER: readonly CardCategory[] = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "battle",
  "land",
];

/**
 * One saved deck, for its owner or for anyone when it is public.
 *
 * Returns null when the deck does not exist *or* the viewer may not see it, so a private deck is indistinguishable
 * from a missing one and its id cannot be probed. Row-level security already hides other people's private decks;
 * `viewerId` is what tells an owner's view apart from a stranger's.
 */
export async function loadDeckPage(db: PublicClient, deckId: string, viewerId: string | null): Promise<DeckPageData | null> {
  const { data: deck, error } = await db
    .from("decks")
    .select("id, user_id, name, is_public, card_count, bracket, updated_at")
    .eq("id", deckId)
    .maybeSingle();
  if (error) throw new Error(`Loading the deck failed: ${error.message}`);
  if (!deck) return null;

  const isOwner = viewerId !== null && deck.user_id === viewerId;
  if (!isOwner && !deck.is_public) return null;

  const { data: rows, error: cardsError } = await db
    .from("deck_cards")
    .select("card_id, section, quantity")
    .eq("deck_id", deckId);
  if (cardsError) throw new Error(`Loading the deck's cards failed: ${cardsError.message}`);

  const cards = await fetchCardsById(
    db,
    (rows ?? []).map((r) => r.card_id),
  );

  const commanders: CardSummary[] = [];
  const byCategory = new Map<CardCategory, DeckPageCard[]>();
  for (const row of rows ?? []) {
    const found = cards.get(row.card_id);
    if (!found) continue;
    const card = toCardSummary(found);
    if (row.section === "commander") {
      commanders.push(card);
      continue;
    }
    const category = cardCategory(card.typeLine);
    byCategory.set(category, [...(byCategory.get(category) ?? []), { card, quantity: row.quantity, category }]);
  }

  const groups = CATEGORY_ORDER.flatMap((category) => {
    const group = byCategory.get(category);
    if (!group) return [];
    return [{ category, cards: [...group].sort((a, b) => a.card.name.localeCompare(b.card.name)) }];
  });

  return {
    id: deck.id as DeckId,
    name: deck.name,
    isPublic: deck.is_public,
    isOwner,
    commanders: [...commanders].sort((a, b) => a.name.localeCompare(b.name)),
    groups,
    cardCount: deck.card_count,
    bracket: (deck.bracket as Bracket | null) ?? null,
    updatedAt: deck.updated_at,
  };
}
