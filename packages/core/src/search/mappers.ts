import { cardCategory } from "../scoring/add";
import {
  colorsToMask,
  maskToColors,
  type CardDocument,
  type CommanderCardDocument,
  type CommanderDocument,
  type TagDocument,
} from "./documents";

/**
 * Pure row-to-document and document-to-row mappers.
 *
 * They live in core, beside the schemas, so the worker that writes a document and the app that reads one cannot
 * disagree about a field. Everything here is total and synchronous, so the round trip is unit-testable without a
 * database or a search server.
 */

/** The `cards` columns a document is built from, as the worker reads them. */
export interface CardIndexRow {
  id: number;
  oracle_id: string;
  name: string;
  name_normalized: string;
  slug: string;
  type_line: string;
  mana_value: number;
  color_identity: number;
  keywords: string[] | null;
  game_changer: boolean;
  is_basic_land: boolean;
  legal_commander: string;
  can_be_commander: boolean;
  partner_kind: string | null;
  partner_qualifier: string | null;
  copy_limit: number | null;
  artist: string | null;
  images: unknown;
  released_at: string | Date | null;
  first_printed_at: string | Date | null;
  reference_price_usd: string | number | null;
  reference_price_finish: string | null;
  prices_as_of: string | Date | null;
  staple_score: number | null;
  baseline_rate: number | null;
  baseline_decks_with: number | null;
  baseline_eligible_decks: number | null;
  commander_deck_count: number | null;
  names: string[] | null;
  tag_ids: string[] | null;
  tag_depths: number[] | null;
}

/**
 * Exactly the shape `apps/web`'s CardRow has, so a document can stand in for a `select CARD_COLUMNS` with no
 * conversion at the call site. Kept structural rather than imported: core must not depend on the app.
 */
export interface CardRowShape {
  id: number;
  oracle_id: string;
  name: string;
  slug: string;
  mana_value: number;
  type_line: string;
  color_identity: number;
  images: unknown;
  game_changer: boolean;
  released_at: string | null;
  reference_price_usd: number | null;
  reference_price_finish: string | null;
  prices_as_of: string | null;
  legal_commander: string;
  can_be_commander: boolean;
  partner_kind: string | null;
  partner_qualifier: string | null;
  copy_limit: number | null;
  is_basic_land: boolean;
  artist: string | null;
  keywords: string[] | null;
}

/** Postgres hands back dates as Date over the wire driver and as text through PostgREST; documents keep text. */
const isoDate = (value: string | Date | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.length === 0 ? undefined : text;
};

/**
 * A timestamp in the shape PostgREST returns it, offset and all.
 *
 * `toISOString()` writes `…Z` where PostgREST writes `…+00:00`. The same instant either way, but the app renders
 * this string and compares it, so a card read from the index and the same card read from the database during a
 * fallback have to be identical — which is exactly what the parity check asserts.
 */
const isoTimestamp = (value: string | Date | null | undefined): string | undefined => {
  const text = isoDate(value);
  return text === undefined ? undefined : text.replace(/Z$/, "+00:00");
};

/** `numeric` arrives as a string from node-postgres; losing that to NaN would silently wipe prices. */
const num = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Typesense rejects a null where it expects a value, so optional fields are omitted rather than nulled. */
const defined = <T extends Record<string, unknown>>(fields: T): T =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as T;

/**
 * The first word of every name a card goes by.
 *
 * Typesense scores by token, not by character position: "smothering" matched "Rug of Smothering" and "Smothering
 * Abomination" with an identical `_text_match`, so the tie fell to whichever was indexed first. `public.search_cards`
 * ranks a name that *starts* with the query above one that merely contains it, and this field is how that tier is
 * expressed — a query token that matches here is matching the head of a name, and the search weights it accordingly.
 */
const headWords = (names: readonly string[]): string[] => [
  ...new Set(names.map((n) => n.split(" ")[0] ?? "").filter((word) => word.length > 0)),
];

export function toCardDocument(row: CardIndexRow, updatedAt = Date.now()): CardDocument {
  return {
    id: String(row.id),
    card_id: row.id,
    oracle_id: row.oracle_id,
    name: row.name,
    name_normalized: row.name_normalized,
    names: row.names ?? [],
    name_head: headWords([row.name_normalized, ...(row.names ?? [])]),
    slug: row.slug,
    type_line: row.type_line,
    // Derived once here rather than at read time: the whole point of the field is that a filter can match on it.
    card_category: cardCategory(row.type_line),
    mana_value: row.mana_value,
    color_identity: row.color_identity,
    colors: maskToColors(row.color_identity),
    keywords: row.keywords ?? [],
    tag_ids: row.tag_ids ?? [],
    tag_depths: row.tag_depths ?? [],
    game_changer: row.game_changer,
    is_basic_land: row.is_basic_land,
    legal_commander: row.legal_commander,
    can_be_commander: row.can_be_commander,
    staple_score: row.staple_score ?? 0,
    // card_global_stats.rate is not null, so a null here means the left join found no row.
    has_baseline: row.baseline_rate !== null && row.baseline_rate !== undefined,
    baseline_rate: row.baseline_rate ?? 0,
    baseline_decks_with: row.baseline_decks_with ?? 0,
    baseline_eligible_decks: row.baseline_eligible_decks ?? 0,
    commander_deck_count: row.commander_deck_count ?? 0,
    updated_at: updatedAt,
    ...defined({
      partner_kind: row.partner_kind ?? undefined,
      partner_qualifier: row.partner_qualifier ?? undefined,
      copy_limit: row.copy_limit ?? undefined,
      artist: row.artist ?? undefined,
      images_json: row.images === null || row.images === undefined ? undefined : JSON.stringify(row.images),
      released_at: isoDate(row.released_at)?.slice(0, 10),
      first_printed_at: isoDate(row.first_printed_at)?.slice(0, 10),
      reference_price_usd: num(row.reference_price_usd),
      reference_price_finish: row.reference_price_finish ?? undefined,
      prices_as_of: isoTimestamp(row.prices_as_of),
    }),
  };
}

/** The inverse: what `fetchCardsById` hands the rest of the app. */
export function cardRowFromDocument(doc: CardDocument): CardRowShape {
  return {
    id: doc.card_id,
    oracle_id: doc.oracle_id,
    name: doc.name,
    slug: doc.slug,
    mana_value: doc.mana_value,
    type_line: doc.type_line,
    color_identity: doc.color_identity ?? colorsToMask(doc.colors),
    images: doc.images_json ? (JSON.parse(doc.images_json) as unknown) : null,
    game_changer: doc.game_changer,
    released_at: doc.released_at ?? null,
    reference_price_usd: doc.reference_price_usd ?? null,
    reference_price_finish: doc.reference_price_finish ?? null,
    prices_as_of: doc.prices_as_of ?? null,
    legal_commander: doc.legal_commander,
    can_be_commander: doc.can_be_commander,
    partner_kind: doc.partner_kind ?? null,
    partner_qualifier: doc.partner_qualifier ?? null,
    copy_limit: doc.copy_limit ?? null,
    is_basic_land: doc.is_basic_land,
    artist: doc.artist ?? null,
    keywords: doc.keywords ?? [],
  };
}

export interface TagIndexRow {
  id: string;
  slug: string;
  label: string;
  idf: number | null;
  disabled: boolean;
}

export function toTagDocument(row: TagIndexRow, updatedAt = Date.now()): TagDocument {
  return { id: row.id, slug: row.slug, label: row.label, idf: row.idf ?? 0, disabled: row.disabled, updated_at: updatedAt };
}

export interface CommanderIndexRow {
  id: number;
  slug: string;
  commander_1: number;
  commander_2: number | null;
  color_identity: number;
  deck_count: number | null;
  names: string[] | null;
}

export function toCommanderDocument(row: CommanderIndexRow, updatedAt = Date.now()): CommanderDocument {
  const names = row.names ?? [];
  return {
    id: String(row.id),
    key_id: row.id,
    slug: row.slug,
    name: names.join(" // "),
    names,
    commander_ids: row.commander_2 === null ? [row.commander_1] : [row.commander_1, row.commander_2],
    color_identity: row.color_identity,
    colors: maskToColors(row.color_identity),
    deck_count: row.deck_count ?? 0,
    updated_at: updatedAt,
  };
}

export interface CommanderCardIndexRow {
  commander_key_id: number;
  card_id: number;
  decks_with: number;
  inclusion_shrunk: number;
  synergy: number;
  color_identity: number;
  game_changer: boolean;
}

export const commanderCardDocumentId = (keyId: number, cardId: number) => `${keyId}:${cardId}`;

export function toCommanderCardDocument(row: CommanderCardIndexRow, updatedAt = Date.now()): CommanderCardDocument {
  return {
    id: commanderCardDocumentId(row.commander_key_id, row.card_id),
    key_id: row.commander_key_id,
    card_id: row.card_id,
    decks_with: row.decks_with,
    inclusion_shrunk: row.inclusion_shrunk,
    synergy: row.synergy,
    colors: maskToColors(row.color_identity),
    game_changer: row.game_changer,
    updated_at: updatedAt,
  };
}

/**
 * A card's functional tags, as the contract's TagRefs. The kill switch is applied **here**, when the document is
 * read, not when it is written: `tags.disabled` is keyed by UUID and is meant to take effect at once, and the tags
 * collection is small enough to keep in memory, so a disabled tag disappears without reindexing 34,800 cards.
 */
export function tagRefsFromDocument(
  doc: Pick<CardDocument, "tag_ids" | "tag_depths">,
  tags: ReadonlyMap<string, TagDocument>,
): { id: string; slug: string; label: string; depth: number }[] {
  return doc.tag_ids
    .flatMap((id, i) => {
      const tag = tags.get(id);
      return tag && !tag.disabled ? [{ id, slug: tag.slug, label: tag.label, depth: doc.tag_depths[i] ?? 0 }] : [];
    })
    .sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label));
}
