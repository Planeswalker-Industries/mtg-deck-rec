import type { CardSummary } from "@mtg/core/contract";
import { normalizeName } from "@mtg/core/parse";
import { CARDS_COLLECTION, cardRowFromDocument, type CardDocument } from "@mtg/core/search";
import { fetchCardsById, toCardSummary } from "./cards";
import { fromIndex } from "./search-index";
import type { PublicClient } from "./supabase";

/**
 * Ranking for the header search and the commander picker, built to answer the way `public.search_cards` does.
 *
 * Three fields, in descending weight, and each one is a tier of that function:
 *
 *   * `name_head` — the first word of every name the card goes by. This is the "starts with" tier. Typesense scores
 *     by token and not by position, so without it "smothering" gave *Rug of Smothering* and *Smothering Abomination*
 *     an identical `_text_match` and the tie fell to indexing order. Measured, not assumed.
 *   * `name` — the "contains" tier, and above `names` so a card whose own name matches beats one matched through a
 *     back face or a flavor name. That is also why results show the full name rather than `displayName`.
 *   * `names` — every alias, which is what makes accents, Alchemy names and back faces findable at all.
 *
 * Typos are the engine's own doing. The play-rate tie-break after the text match is the last tier: among cards that
 * match a query equally well, the one people actually build decks around comes first.
 */
const QUERY_BY = "name_head,name,names";
const QUERY_BY_WEIGHTS = "5,3,1";
const SORT_BY = "_text_match:desc,commander_deck_count:desc,staple_score:desc";

/** Cards whose name matches the query, best match first (see public.search_cards). */
export async function searchCards(
  db: PublicClient,
  { q, commanderEligible = false, limit = 8 }: { q: string; commanderEligible?: boolean | undefined; limit?: number | undefined },
): Promise<CardSummary[]> {
  const query = normalizeName(q);
  if (query.length < 2) return [];

  // The index answers with whole documents, so a hit needs no second round trip for the card rows.
  const indexed = await fromIndex("Card search", async (index) => {
    const result = await index.search<CardDocument>(CARDS_COLLECTION, {
      q: query,
      query_by: QUERY_BY,
      query_by_weights: QUERY_BY_WEIGHTS,
      sort_by: SORT_BY,
      per_page: limit,
      prefix: true,
      ...(commanderEligible ? { filter_by: "can_be_commander:=true && legal_commander:=legal" } : {}),
    });
    return (result.hits ?? []).map((hit) => hit.document);
  });
  if (indexed) return indexed.value.map((doc) => toCardSummary(cardRowFromDocument(doc)));

  const { data, error } = await db.rpc("search_cards", { p_query: query, p_commander_only: commanderEligible, p_limit: limit });
  if (error) throw new Error(`Card search failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.card_id);
  const rows = await fetchCardsById(db, ids);
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
}
