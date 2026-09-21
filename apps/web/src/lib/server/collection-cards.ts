import type { CardSet, CollectionCardsResult } from "@mtg/core/contract";
import { fetchCardTags } from "./card-tags";
import { fetchCardsById, toCardSummary } from "./cards";
import type { PublicClient } from "./supabase";

/**
 * The collection view's cards with their functional tag labels, plus the sets it names. Public catalog data, the same
 * for everyone: which cards someone owns never reaches this, only ids the browser already holds. The three reads are
 * independent, so they run together.
 */
export async function loadCollectionCards(
  db: PublicClient,
  cardIds: readonly number[],
  setCodes: readonly string[],
): Promise<CollectionCardsResult> {
  const codes = [...new Set(setCodes.map((code) => code.toUpperCase()))];
  const [rows, tags, sets] = await Promise.all([
    fetchCardsById(db, cardIds),
    fetchCardTags(db, cardIds),
    codes.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from("sets").select("code, name, set_type, released_at").in("code", codes),
  ]);
  if (sets.error) throw new Error(`Loading sets failed: ${sets.error.message}`);

  const labels = new Map(tags.map((t) => [t.cardId as number, t.tags.map((tag) => tag.label)]));
  return {
    cards: [...rows.values()].map((row) => ({ card: toCardSummary(row), tags: labels.get(row.id) ?? [] })),
    sets: (sets.data ?? []).map(
      (s): CardSet => ({ code: s.code, name: s.name, setType: s.set_type, releasedAt: s.released_at }),
    ),
  };
}

