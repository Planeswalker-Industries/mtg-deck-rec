import type { CardSummary } from "@mtg/core/contract";
import { FEATURED_DECKS, type FeaturedDeck } from "../featured-decks";
import { CARD_COLUMNS, toCardSummary, type CardRow } from "./cards";
import type { PublicClient } from "./supabase";

export interface FeaturedCommander {
  deck: FeaturedDeck;
  /** Card summary when the database has the commander; null lets the section render from the fixture alone. */
  card: CardSummary | null;
  /** How many corpus decks lead this commander, or null when the corpus isn't reachable. */
  deckCount: number | null;
}

/**
 * The featured-commanders carousel's data. The list itself is the checked-in fixture, so the section
 * always renders; the database only enriches it with card art, color identity and deck counts.
 *
 * Everything database-shaped is best-effort and caught: the landing page must render with the
 * database down, and CI has no catalog at all. Null db or any error leaves the fixture-only entries.
 */
export async function loadFeaturedCommanders(db: PublicClient | null): Promise<FeaturedCommander[]> {
  const base: FeaturedCommander[] = FEATURED_DECKS.map((deck) => ({ deck, card: null, deckCount: null }));
  if (!db) return base;

  try {
    const slugs = FEATURED_DECKS.map((d) => d.slug);
    const [cardsResult, keysResult] = await Promise.all([
      db.from("cards").select(CARD_COLUMNS).in("slug", slugs).is("deleted_at", null),
      db.from("commander_keys").select("id, slug").in("slug", slugs),
    ]);

    const rowsBySlug = new Map(((cardsResult.data ?? []) as CardRow[]).map((row) => [row.slug, row]));
    const keys = keysResult.data ?? [];
    const keyBySlug = new Map(keys.map((k) => [k.slug, k]));

    const countByKey = new Map<number, number>();
    if (keys.length > 0) {
      const { data: stats } = await db
        .from("commander_stats")
        .select("commander_key_id, deck_count")
        .in("commander_key_id", keys.map((k) => k.id));
      for (const stat of stats ?? []) countByKey.set(stat.commander_key_id, stat.deck_count);
    }

    return base.map((entry) => {
      const row = rowsBySlug.get(entry.deck.slug) ?? null;
      const key = keyBySlug.get(entry.deck.slug) ?? null;
      return {
        ...entry,
        card: row ? toCardSummary(row) : null,
        deckCount: key ? (countByKey.get(key.id) ?? 0) : null,
      };
    });
  } catch {
    return base;
  }
}
