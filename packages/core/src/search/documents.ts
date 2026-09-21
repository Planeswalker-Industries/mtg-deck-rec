/**
 * The documents the search index holds, and the collection schemas that describe them.
 *
 * This file is the contract between the worker that writes the index and the app that reads it: both import these
 * types, so a field can't be added on one side and missed on the other. It deliberately holds no I/O — the mappers
 * beside it are pure, and the client is a separate file — so the whole shape can be unit-tested without a server.
 *
 * Why an index at all: the hosted database is a 500 MB free tier with a 3 s statement timeout on the `anon` role, and
 * the highest-volume reads (fetch these 400 cards, rank these names, does this slug exist) are document lookups that
 * cost Postgres a heap visit each. See docs/roadmap/typesense-plan.md.
 */

export const CARDS_COLLECTION = "cards";
export const TAGS_COLLECTION = "tags";
export const COMMANDERS_COLLECTION = "commanders";
export const COMMANDER_CARDS_COLLECTION = "commander_cards";

export const COLLECTIONS = [CARDS_COLLECTION, TAGS_COLLECTION, COMMANDERS_COLLECTION, COMMANDER_CARDS_COLLECTION] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** Colour letters in the order the rest of the app uses. The index filters on these, not on the bitmask. */
export const COLOR_LETTERS = ["W", "U", "B", "R", "G"] as const;
export type ColorLetter = (typeof COLOR_LETTERS)[number];

/** W=1 U=2 B=4 R=8 G=16, the same bitmask `cards.color_identity` stores. */
export function maskToColors(mask: number): ColorLetter[] {
  return COLOR_LETTERS.filter((_, i) => (mask & (1 << i)) !== 0);
}

export function colorsToMask(colors: readonly string[]): number {
  return colors.reduce((mask, c) => {
    const i = COLOR_LETTERS.indexOf(c as ColorLetter);
    return i === -1 ? mask : mask | (1 << i);
  }, 0);
}

/**
 * One oracle card.
 *
 * The document id is the **card id as text**, never the slug. A slug is derived from a name and a rename changes it
 * (which is why `slug_redirects` exists), so keying documents by slug would leave the old one orphaned in the index
 * with no cheap way to find it. The surrogate id never changes and is never reissued.
 *
 * `oracle_text` and `card_faces` are deliberately absent: only the card page needs them, that page is cached for days,
 * and they are most of what makes `cards` a 92 MB table.
 */
export interface CardDocument {
  /** = String(card_id). */
  id: string;
  card_id: number;
  oracle_id: string;
  name: string;
  name_normalized: string;
  /** Every name a decklist or a search box might use: full, face, flavor, printed, Alchemy. */
  names: string[];
  /** The first word of each of those names — the index's way of ranking "starts with" above "contains". */
  name_head: string[];
  slug: string;
  type_line: string;
  mana_value: number;
  /** The smallint bitmask, kept so a document round-trips to a CardRow exactly. */
  color_identity: number;
  /** The same identity as letters, because Typesense has no bitwise operators (see identityFilter). */
  colors: ColorLetter[];
  keywords: string[];
  /**
   * Functional tags the card reaches, walked up the hierarchy at most two steps — the same set
   * `cards_functional_tags` returns, minus its kill-switch filter, which is applied when the document is read so
   * that disabling a tag still takes effect without waiting for a reindex.
   *
   * `tag_depths` runs parallel to `tag_ids` rather than the two being an object[]: nested fields have to be enabled
   * collection-wide and indexed, and nothing ever filters on a depth.
   */
  tag_ids: string[];
  tag_depths: number[];
  game_changer: boolean;
  is_basic_land: boolean;
  legal_commander: string;
  can_be_commander: boolean;
  partner_kind?: string;
  partner_qualifier?: string;
  copy_limit?: number;
  artist?: string;
  /** CardImages as JSON text: storing it as an object would mean turning nested fields on for one unindexed payload. */
  images_json?: string;
  released_at?: string;
  /** card_stats.first_printed_at — what release-aware play rates count from, never cards.released_at. */
  first_printed_at?: string;
  reference_price_usd?: number;
  reference_price_finish?: string;
  prices_as_of?: string;
  staple_score: number;
  /**
   * Whether `card_global_stats` holds a row for this card at all.
   *
   * Not the same question as "are the counts zero". Without a row the caller counts the decks that *could* have run
   * the card from the identity histograms instead, which is the difference between "nobody plays this" and "nothing
   * is known about this yet" — the distinction `corpusComponent` exists to preserve.
   */
  has_baseline: boolean;
  /** card_global_stats: the baseline play rate p0 and the decks it was measured over. */
  baseline_rate: number;
  baseline_decks_with: number;
  baseline_eligible_decks: number;
  /** Decks led by this card as a solo commander; the sort key that puts real commanders first in a picker. */
  commander_deck_count: number;
  updated_at: number;
}

/** One Tagger tag. Small, rarely changes, and it is what turns a card's tag ids into the contract's TagRefs. */
export interface TagDocument {
  /** = the Tagger UUID. Tags are never keyed by slug; slugs and labels are display-only and can change. */
  id: string;
  slug: string;
  label: string;
  idf: number;
  /** The kill switch. Read-time, so flipping it doesn't wait for a card reindex. */
  disabled: boolean;
  updated_at: number;
}

/** One commander or partner pair. */
export interface CommanderDocument {
  /** = String(key_id), for the same reason a card document is keyed by its id. */
  id: string;
  key_id: number;
  slug: string;
  /** The commanders' names joined with " // ", for name search. */
  name: string;
  names: string[];
  commander_ids: number[];
  color_identity: number;
  colors: ColorLetter[];
  deck_count: number;
  updated_at: number;
}

/** One (commander key, card) play rate. The collection that grows with the corpus — watch its size. */
export interface CommanderCardDocument {
  /** = "<key_id>:<card_id>". */
  id: string;
  key_id: number;
  card_id: number;
  decks_with: number;
  inclusion_shrunk: number;
  synergy: number;
  /** The card's identity, so a borrowed key can be filtered to the colours the deck allows. */
  colors: ColorLetter[];
  game_changer: boolean;
  updated_at: number;
}

export interface CollectionField {
  name: string;
  type: string;
  optional?: boolean;
  index?: boolean;
  facet?: boolean;
  sort?: boolean;
}

export interface CollectionSchema {
  name: string;
  fields: CollectionField[];
  default_sorting_field?: string;
}

/**
 * `index: false` marks a field the index stores and returns but never searches, filters or sorts on — images, the
 * partner columns, the price finish. They cost disk, not RAM, which is what keeps this affordable on a small VPS.
 */
export const CARD_SCHEMA: CollectionSchema = {
  name: CARDS_COLLECTION,
  default_sorting_field: "commander_deck_count",
  fields: [
    { name: "card_id", type: "int32" },
    { name: "oracle_id", type: "string", index: false, optional: true },
    { name: "name", type: "string" },
    { name: "name_normalized", type: "string" },
    { name: "names", type: "string[]" },
    { name: "name_head", type: "string[]" },
    // Indexed because `proxy.ts` resolves a URL segment to a page through it on every card page view.
    { name: "slug", type: "string" },
    { name: "type_line", type: "string" },
    { name: "mana_value", type: "float" },
    { name: "color_identity", type: "int32", index: false, optional: true },
    { name: "colors", type: "string[]", facet: true },
    { name: "keywords", type: "string[]", facet: true },
    { name: "tag_ids", type: "string[]", facet: true },
    { name: "tag_depths", type: "int32[]", index: false, optional: true },
    { name: "game_changer", type: "bool" },
    { name: "is_basic_land", type: "bool" },
    { name: "legal_commander", type: "string", facet: true },
    { name: "can_be_commander", type: "bool" },
    { name: "partner_kind", type: "string", index: false, optional: true },
    { name: "partner_qualifier", type: "string", index: false, optional: true },
    { name: "copy_limit", type: "int32", index: false, optional: true },
    { name: "artist", type: "string", index: false, optional: true },
    { name: "images_json", type: "string", index: false, optional: true },
    { name: "released_at", type: "string", index: false, optional: true },
    { name: "first_printed_at", type: "string", index: false, optional: true },
    { name: "reference_price_usd", type: "float", optional: true },
    { name: "reference_price_finish", type: "string", index: false, optional: true },
    { name: "prices_as_of", type: "string", index: false, optional: true },
    { name: "staple_score", type: "float" },
    { name: "has_baseline", type: "bool" },
    { name: "baseline_rate", type: "float" },
    { name: "baseline_decks_with", type: "int32" },
    { name: "baseline_eligible_decks", type: "int32" },
    { name: "commander_deck_count", type: "int32" },
    { name: "updated_at", type: "int64" },
  ],
};

export const TAG_SCHEMA: CollectionSchema = {
  name: TAGS_COLLECTION,
  fields: [
    { name: "slug", type: "string" },
    { name: "label", type: "string" },
    { name: "idf", type: "float" },
    { name: "disabled", type: "bool" },
    { name: "updated_at", type: "int64" },
  ],
};

export const COMMANDER_SCHEMA: CollectionSchema = {
  name: COMMANDERS_COLLECTION,
  default_sorting_field: "deck_count",
  fields: [
    { name: "key_id", type: "int32" },
    { name: "slug", type: "string" },
    { name: "name", type: "string" },
    { name: "names", type: "string[]" },
    { name: "commander_ids", type: "int32[]" },
    { name: "color_identity", type: "int32", index: false, optional: true },
    { name: "colors", type: "string[]", facet: true },
    { name: "deck_count", type: "int32" },
    { name: "updated_at", type: "int64" },
  ],
};

export const COMMANDER_CARD_SCHEMA: CollectionSchema = {
  name: COMMANDER_CARDS_COLLECTION,
  default_sorting_field: "inclusion_shrunk",
  fields: [
    { name: "key_id", type: "int32" },
    { name: "card_id", type: "int32" },
    { name: "decks_with", type: "int32" },
    { name: "inclusion_shrunk", type: "float" },
    { name: "synergy", type: "float" },
    { name: "colors", type: "string[]", facet: true },
    { name: "game_changer", type: "bool" },
    { name: "updated_at", type: "int64" },
  ],
};

export const SCHEMAS: Record<CollectionName, CollectionSchema> = {
  [CARDS_COLLECTION]: CARD_SCHEMA,
  [TAGS_COLLECTION]: TAG_SCHEMA,
  [COMMANDERS_COLLECTION]: COMMANDER_SCHEMA,
  [COMMANDER_CARDS_COLLECTION]: COMMANDER_CARD_SCHEMA,
};

/**
 * "Every colour in the card's identity is one the deck allows" — the index's way of writing
 * `(c.color_identity & ~p_identity_mask) = 0`. Colourless fits everything, so an empty `colors` array always passes,
 * and a five-colour deck excludes nothing and needs no filter at all.
 */
export function identityFilter(identityMask: number, field = "colors"): string | null {
  const disallowed = COLOR_LETTERS.filter((_, i) => (identityMask & (1 << i)) === 0);
  return disallowed.length === 0 ? null : `${field}:!=[${disallowed.join(",")}]`;
}
