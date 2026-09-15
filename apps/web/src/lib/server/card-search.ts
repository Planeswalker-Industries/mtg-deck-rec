import type { CardSummary } from "@mtg/core/contract";
import { normalizeName } from "@mtg/core/parse";
import { fetchCardsById, toCardSummary } from "./cards";
import type { PublicClient } from "./supabase";

/** Cards whose name matches the query, best match first (see public.search_cards). */
export async function searchCards(
  db: PublicClient,
  { q, commanderEligible = false, limit = 8 }: { q: string; commanderEligible?: boolean | undefined; limit?: number | undefined },
): Promise<CardSummary[]> {
  const query = normalizeName(q);
  if (query.length < 2) return [];
  const { data, error } = await db.rpc("search_cards", { p_query: query, p_commander_only: commanderEligible, p_limit: limit });
  if (error) throw new Error(`Card search failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.card_id);
  const rows = await fetchCardsById(db, ids);
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
}
