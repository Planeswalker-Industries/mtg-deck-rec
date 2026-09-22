import type { CardCategory, CardSummary } from "@mtg/core/contract";
import { CURVE_TOP_MANA_VALUE } from "@mtg/core/journey";
import { normalizeName } from "@mtg/core/parse";
import { cardRowFromDocument, colorsToMask } from "@mtg/core/search";

/** WUBRG: every colour, for a search with no colour limit. */
const ALL_COLORS_MASK = colorsToMask([..."WUBRG"]);
import { fetchCardsById, toCardSummary } from "./cards";
import { fromIndex } from "./search-index";
import type { PublicClient } from "./supabase";

/** Cards whose name matches the query, best match first (see public.search_cards). */
/** The deckbuilder's page of results when it browses with filters. */
const FILTERED_DEFAULT_LIMIT = 20;

export async function searchCards(
  db: PublicClient,
  input: {
    q: string;
    commanderEligible?: boolean | undefined;
    limit?: number | undefined;
    colorIdentity?: string | undefined;
    cardType?: CardCategory | undefined;
    manaValue?: number | undefined;
    offset?: number | undefined;
  },
): Promise<CardSummary[]> {
  const { q, commanderEligible = false, limit = 8 } = input;
  const query = normalizeName(q);
  // A later page always comes from Postgres: the search index doesn't page, and asking it for "more" would return the
  // first page again.
  const filtered =
    input.colorIdentity !== undefined || input.cardType !== undefined || input.manaValue !== undefined || (input.offset ?? 0) > 0;
  if (filtered) return searchFiltered(db, { ...input, query });
  if (query.length < 2) return [];

  // The index answers with whole documents, so a hit needs no second round trip for the card rows. How results are
  // ranked lives in the search API, next to the engine it has to be tuned against; see its cardsSearch handler.
  const indexed = await fromIndex("Card search", (index) => index.searchCards({ q: query, commanderOnly: commanderEligible, limit }));
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

/**
 * The deckbuilder's search: a name (optional) narrowed by colours, type and mana value, or with no name a browse of the
 * filtered cards by play rate. Always Postgres: the search index has no card-type field yet (see the migration).
 */
async function searchFiltered(
  db: PublicClient,
  input: {
    query: string;
    limit?: number | undefined;
    colorIdentity?: string | undefined;
    cardType?: CardCategory | undefined;
    manaValue?: number | undefined;
    offset?: number | undefined;
  },
): Promise<CardSummary[]> {
  const { data, error } = await db.rpc("search_cards_filtered", {
    p_query: input.query,
    p_identity_mask: input.colorIdentity === undefined ? ALL_COLORS_MASK : colorsToMask([...input.colorIdentity]),
    p_category: input.cardType ?? undefined,
    p_mana_value: input.manaValue ?? undefined,
    p_mana_value_top: CURVE_TOP_MANA_VALUE,
    p_limit: input.limit ?? FILTERED_DEFAULT_LIMIT,
    p_offset: input.offset ?? 0,
  });
  if (error) throw new Error(`Card search failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.card_id);
  const rows = await fetchCardsById(db, ids);
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
}
