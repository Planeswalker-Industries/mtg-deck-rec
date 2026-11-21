import type { PublicClient } from "./supabase";

/**
 * Each card's cheapest printing's TCGplayer product id, by card id; cards without one are left out. A read error only
 * logs and returns what it has (nothing): a preview deploy on main's schema has no cheapest_printing_id yet, and the
 * pages then link a TCGplayer search instead.
 */
export async function loadTcgplayerProductIds(db: PublicClient, cardIds: readonly number[]): Promise<Map<number, number>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from("card_stats")
    .select("card_id, cheapest_finish, printing:printings!cheapest_printing_id(tcgplayer_id, tcgplayer_etched_id)")
    .in("card_id", ids);
  if (error) {
    console.error(`Loading the cheapest printings failed: ${error.message}`);
    return new Map();
  }
  return new Map(
    data.flatMap((row) => {
      const printing = row.printing;
      const id = printing ? (row.cheapest_finish === "etched" ? printing.tcgplayer_etched_id : printing.tcgplayer_id) : null;
      return id === null || id === undefined ? [] : [[row.card_id, id] as const];
    }),
  );
}
