import type { CardSearchSort, CardSummary, CardTypeFilter } from "@mtg/core/contract";
import { CURVE_TOP_MANA_VALUE } from "@mtg/core/journey";
import { normalizeName } from "@mtg/core/parse";
import { cardRowFromDocument, colorsToMask } from "@mtg/core/search";

/** WUBRG: every colour, for a search with no colour limit. */
const ALL_COLORS_MASK = colorsToMask([..."WUBRG"]);
import { fetchCardsById, toCardSummary } from "./cards";
import { fromIndex, getSearchIndex } from "./search-index";
import type { PublicClient } from "./supabase";

/**
 * Which backend answered, and when it wasn't the index, why not. Reported on the response as `x-search-source`.
 *
 * This exists because the two backends are indistinguishable from outside: the index is an optimisation that falls
 * back silently by design, so "the index served this" and "the index is not configured" produce identical results
 * and identical logs. Without a name for what happened, checking which one ran means reading server logs that a
 * successful request never writes.
 */
export type SearchSource =
  | "index" // Typesense, through the search API
  | "index-filtered" // the same, answering the deckbuilder's colour/type/mana search or its browse
  | "postgres-filtered" // the deckbuilder's search, fallen back to search_cards_filtered
  | "postgres-owned" // the deckbuilder's search limited to a collection, which only Postgres answers
  | "postgres-unconfigured" // no SEARCH_API_URL or SEARCH_API_TOKEN in this environment
  | "postgres-index-failed" // the index is configured but did not answer; the warning is in the server log
  | "empty"; // the query was too short to run

export interface SearchResult {
  cards: CardSummary[];
  source: SearchSource;
}

/** Cards whose name matches the query, best match first (see public.search_cards). */
/** The deckbuilder's page of results when it browses with filters. */
const FILTERED_DEFAULT_LIMIT = 20;
/** A name shorter than this is not a name search: the filters alone decide, and the deckbuilder browses. */
const MIN_QUERY_CHARS = 2;

/** A card search as the route hands it over: a collection already turned into its card ids. */
export interface CardSearchQuery {
  q: string;
  commanderEligible?: boolean | undefined;
  limit?: number | undefined;
  colorIdentity?: string | undefined;
  cardTypes?: CardTypeFilter[] | undefined;
  manaValues?: number[] | undefined;
  offset?: number | undefined;
  sort?: CardSearchSort | undefined;
  /** Only these cards: the collection the search is limited to. */
  ownedCardIds?: readonly number[] | undefined;
}

export async function searchCards(db: PublicClient, input: CardSearchQuery): Promise<SearchResult> {
  const { q, commanderEligible = false, limit = 8 } = input;
  const query = normalizeName(q);
  // The deckbuilder's search: narrowed by colours, type or mana value, or paged past the first screen. It browses by
  // play rate when there is no name, so unlike a plain search an empty query is a real question here.
  const filtered =
    input.colorIdentity !== undefined ||
    (input.cardTypes?.length ?? 0) > 0 ||
    (input.manaValues?.length ?? 0) > 0 ||
    (input.offset ?? 0) > 0 ||
    input.sort !== undefined ||
    input.ownedCardIds !== undefined;
  if (!filtered && query.length < 2) return { cards: [], source: "empty" };

  // A collection can run to tens of thousands of ids, which no index filter should carry; Postgres matches them as a
  // hashed set. Owned searches are private and uncached, so they are few.
  if (input.ownedCardIds !== undefined) return { cards: await searchFiltered(db, { ...input, query }), source: "postgres-owned" };

  // The index answers with whole documents, so a hit needs no second round trip for the card rows. How results are
  // ranked lives in the search API, next to the engine it has to be tuned against; see its cardsSearch handler.
  const indexed = await fromIndex("Card search", (index) =>
    index.searchCards({
      q: filtered && query.length < MIN_QUERY_CHARS ? "" : query,
      commanderOnly: commanderEligible,
      limit: filtered ? (input.limit ?? FILTERED_DEFAULT_LIMIT) : limit,
      builder: filtered,
      ...(input.colorIdentity !== undefined ? { colorIdentity: input.colorIdentity } : {}),
      ...(input.cardTypes?.length ? { cardTypes: input.cardTypes } : {}),
      ...(input.manaValues?.length ? { manaValues: input.manaValues } : {}),
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
    }),
  );
  if (indexed) {
    return {
      cards: indexed.value.map((doc) => toCardSummary(cardRowFromDocument(doc))),
      source: filtered ? "index-filtered" : "index",
    };
  }

  // Everything below is the fallback. Same rule as every other index read: unconfigured, slow or broken falls through
  // to the query this always ran, and the caller cannot tell the difference except from `x-search-source`.
  if (filtered) return { cards: await searchFiltered(db, { ...input, query }), source: "postgres-filtered" };
  if (query.length < 2) return { cards: [], source: "empty" };
  // getSearchIndex() is what separates the two ways fromIndex answers null, and they need different fixes: nothing
  // configured is a deployment that was never given the variables, while a configured index that did not answer is
  // one that is down, slow or missing its collections.
  const source: SearchSource = getSearchIndex() ? "postgres-index-failed" : "postgres-unconfigured";

  const { data, error } = await db.rpc("search_cards", { p_query: query, p_commander_only: commanderEligible, p_limit: limit });
  if (error) throw new Error(`Card search failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.card_id);
  const rows = await fetchCardsById(db, ids);
  return {
    cards: ids.flatMap((id) => {
      const row = rows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    source,
  };
}

/**
 * The deckbuilder's search in Postgres: a name (optional) narrowed by colours, card types (all) and mana values (any), or with no name a
 * browse of the filtered cards by play rate.
 *
 * This is now the **fallback**, except for a search limited to a collection, which only runs here. The index serves the
 * rest first; `search_cards_filtered` answers when there is no index configured, or the one there is did not answer.
 */
async function searchFiltered(db: PublicClient, input: Omit<CardSearchQuery, "q"> & { query: string }): Promise<CardSummary[]> {
  const { data, error } = await db.rpc("search_cards_filtered", {
    p_query: input.query,
    p_identity_mask: input.colorIdentity === undefined ? ALL_COLORS_MASK : colorsToMask([...input.colorIdentity]),
    p_card_types: input.cardTypes ?? [],
    p_mana_values: input.manaValues ?? [],
    p_mana_value_top: CURVE_TOP_MANA_VALUE,
    p_limit: input.limit ?? FILTERED_DEFAULT_LIMIT,
    p_offset: input.offset ?? 0,
    p_commander_only: input.commanderEligible ?? false,
    ...(input.ownedCardIds !== undefined ? { p_owned_ids: [...input.ownedCardIds] } : {}),
    ...(input.sort !== undefined ? { p_sort: input.sort } : {}),
  });
  if (error) throw new Error(`Card search failed: ${error.message}`);
  const ids = (data ?? []).map((r) => r.card_id);
  const rows = await fetchCardsById(db, ids);
  return ids.flatMap((id) => {
    const row = rows.get(id);
    return row ? [toCardSummary(row)] : [];
  });
}
