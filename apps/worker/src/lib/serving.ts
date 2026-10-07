import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  curveBucket,
  isFrontLand,
  parseCorpusSettings,
  parseScoringConfig,
  type BaselineCounts,
  type CardFacts,
  type CorpusKey,
  type CorpusSettings,
  type EdhrecListing,
  type EdhrecPage,
  type ScoringConfig,
} from '@mtg/core/scoring';
import type { ReservedSql, Sql } from './db';

/** What the precompute worker reads to build the serving tables (T055). */

/** Rows read from commander_card_stats per round trip. */
const STATS_CURSOR_ROWS = 20_000;
/** commander_card_stats.eligible_decks is null on rows from before release-aware counting. */
const NO_ELIGIBLE_COUNT = -1;
/** COPY rows are sent in chunks of about this many characters. */
const COPY_CHUNK_CHARS = 1 << 16;

/** One key's commander_card_stats rows, as parallel arrays (a million and a half rows don't fit as objects). */
/**
 * JSON with every object's keys sorted, for comparing settings with what was stored: key order doesn't survive a round
 * trip through jsonb, so a plain JSON.stringify of the two never matches.
 */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

export interface KeyRows {
  cardIds: Int32Array;
  decksWith: Int32Array;
  /** NO_ELIGIBLE_COUNT where the row has none. */
  eligible: Int32Array;
}

export const eligibleAt = (rows: KeyRows, i: number): number | null => {
  const n = rows.eligible[i] ?? NO_ELIGIBLE_COUNT;
  return n === NO_ELIGIBLE_COUNT ? null : n;
};

/** app_config.corpus's scoring settings (required). */
export async function loadServingSettings(sql: Sql): Promise<CorpusSettings> {
  const [row] = await sql<{ value: unknown }[]>`select value from public.app_config where key = 'corpus'`;
  return parseCorpusSettings(row?.value);
}

/** A commander's (or pair's) EDHREC page as the prior reads it: its size, its floor, and the cards it lists. */
export interface PageRows {
  page: EdhrecPage;
  listings: Map<number, EdhrecListing>;
}

/**
 * Every collated EDHREC page, keyed by its commander cards ('c1:c2', c2 0 for one). The floor is the page's
 * listed_floor, or its lowest listed rate where the collator hasn't filled that in yet.
 */
export async function loadEdhrecPages(sql: Sql): Promise<Map<string, PageRows>> {
  const rows = await sql<{ commander_1: number; commander_2: number; deck_count: number; listed_floor: number | null; card_id: number; decks_with: number; potential_decks: number }[]>`
    select e.commander_1, coalesce(e.commander_2, 0) as commander_2, e.deck_count, e.listed_floor,
           c.card_id, c.decks_with, c.potential_decks
    from corpus.edhrec_commanders e
    join corpus.edhrec_commander_cards c on c.edhrec_commander_id = e.id
  `;
  const pages = new Map<string, PageRows>();
  for (const r of rows) {
    const key = `${r.commander_1}:${r.commander_2}`;
    let p = pages.get(key);
    if (!p) {
      p = { page: { deckCount: r.deck_count, floor: r.listed_floor ?? Number.POSITIVE_INFINITY }, listings: new Map() };
      pages.set(key, p);
    }
    const rate = r.decks_with / Math.max(r.potential_decks, 1);
    p.listings.set(r.card_id, { rate, potentialDecks: r.potential_decks });
    if (r.listed_floor === null) p.page.floor = Math.min(p.page.floor, rate);
  }
  return pages;
}

/** Each card's mana value and whether its front face is a land, for curve profiles (T062). */
export interface CardShape {
  manaValue: number;
  isLand: boolean;
}

export async function loadCardShapes(sql: Sql): Promise<Map<number, CardShape>> {
  const rows = await sql<{ id: number; mana_value: number; type_line: string }[]>`
    select id, mana_value::double precision as mana_value, type_line from public.cards where deleted_at is null
  `;
  return new Map(rows.map((r) => [r.id, { manaValue: r.mana_value, isLand: isFrontLand(r.type_line) }]));
}

/** Two places: the profiles are averages of card counts. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * EDHREC's role and curve profiles for a page (T062): the summed inclusion of its listed cards in each tracked role and,
 * for nonland cards, at each mana value bucket. Summed inclusion is the expected number of such cards per deck; pages
 * are trimmed, so it runs a little under.
 */
export function edhrecProfiles(
  page: PageRows,
  rolesByCard: ReadonlyMap<number, readonly string[]>,
  shapes: ReadonlyMap<number, CardShape>,
): { roles: Record<string, number>; curve: Record<string, number> } {
  const roles: Record<string, number> = {};
  const curve: Record<string, number> = {};
  for (const [cardId, listing] of page.listings) {
    for (const role of rolesByCard.get(cardId) ?? []) roles[role] = (roles[role] ?? 0) + listing.rate;
    const shape = shapes.get(cardId);
    if (shape && !shape.isLand) {
      const bucket = curveBucket(shape.manaValue);
      curve[bucket] = (curve[bucket] ?? 0) + listing.rate;
    }
  }
  const rounded = (profile: Record<string, number>) =>
    Object.fromEntries(Object.entries(profile).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, round2(v)]));
  return { roles: rounded(roles), curve: rounded(curve) };
}

/** app_config.scoring (required): the weights and thresholds the stored scores are computed with. */
export async function loadScoringConfig(sql: Sql): Promise<ScoringConfig> {
  const [row] = await sql<{ value: unknown }[]>`select value from public.app_config where key = 'scoring'`;
  return parseScoringConfig(row?.value);
}

/** Every commander key, with its decks when it has any (a key whose decks are gone keeps its page row). */
export interface KeyRow extends CorpusKey {
  /** Whether either commander can take a partner (partner, friends forever, a background, ...). */
  partners: boolean;
}

export async function loadKeys(sql: Sql): Promise<KeyRow[]> {
  const rows = await sql<
    { id: number; commander_1: number; commander_2: number | null; color_identity: number; deck_count: number | null; deck_months: Record<string, number> | null; partners: boolean }[]
  >`
    select k.id, k.commander_1, k.commander_2, k.color_identity, s.deck_count, s.deck_months,
           (c1.partner_kind is not null or c2.partner_kind is not null) as partners
    from public.commander_keys k
    left join public.commander_stats s on s.commander_key_id = k.id
    join public.cards c1 on c1.id = k.commander_1
    left join public.cards c2 on c2.id = k.commander_2
    order by k.id
  `;
  return rows.map((r) => ({
    id: r.id,
    commander1: r.commander_1,
    commander2: r.commander_2,
    identity: r.color_identity,
    deckCount: r.deck_count ?? 0,
    deckMonths: r.deck_months ?? {},
    partners: r.partners,
  }));
}

/** commander_card_stats, grouped by key. */
export async function loadKeyRows(sql: Sql, keyIds?: readonly number[]): Promise<Map<number, KeyRows>> {
  const grouped = new Map<number, { cardIds: number[]; decksWith: number[]; eligible: number[] }>();
  const cursor = (
    keyIds
      ? sql<{ commander_key_id: number; card_id: number; decks_with: number; eligible_decks: number | null }[]>`
          select commander_key_id, card_id, decks_with, eligible_decks from public.commander_card_stats
          where commander_key_id = any (${keyIds as number[]}::int[])
        `
      : sql<{ commander_key_id: number; card_id: number; decks_with: number; eligible_decks: number | null }[]>`
          select commander_key_id, card_id, decks_with, eligible_decks from public.commander_card_stats
        `
  ).cursor(STATS_CURSOR_ROWS);
  for await (const rows of cursor) {
    for (const r of rows) {
      let key = grouped.get(r.commander_key_id);
      if (!key) {
        key = { cardIds: [], decksWith: [], eligible: [] };
        grouped.set(r.commander_key_id, key);
      }
      key.cardIds.push(r.card_id);
      key.decksWith.push(r.decks_with);
      key.eligible.push(r.eligible_decks ?? NO_ELIGIBLE_COUNT);
    }
  }
  return new Map(
    [...grouped].map(([id, k]) => [id, { cardIds: Int32Array.from(k.cardIds), decksWith: Int32Array.from(k.decksWith), eligible: Int32Array.from(k.eligible) }]),
  );
}

/** card_global_stats: each card's baseline. */
export async function loadBaselines(sql: Sql): Promise<Map<number, BaselineCounts>> {
  const rows = await sql<{ card_id: number; decks_with: number; eligible_decks: number; rate: number }[]>`
    select card_id, decks_with, eligible_decks, rate from public.card_global_stats
  `;
  return new Map(rows.map((r) => [r.card_id, { rate: r.rate, decksWith: r.decks_with, eligibleDecks: r.eligible_decks }]));
}

/** Colours and release month of every card, live or not: a deck can still hold a card the catalog has since dropped. */
export async function loadCardFacts(sql: Sql): Promise<Map<number, CardFacts>> {
  const rows = await sql<{ id: number; color_identity: number; release_month: string | null }[]>`
    -- First printing, not cards.released_at: Oracle Cards dates a card by its representative (often latest) printing.
    select c.id, c.color_identity, to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM') as release_month
    from public.cards c
    left join public.card_stats st on st.card_id = c.id
  `;
  return new Map(rows.map((r) => [r.id, { identity: r.color_identity, releaseMonth: r.release_month }]));
}

/** corpus_identity_stats: decks per month for each colour identity. */
export async function loadIdentityMonths(sql: Sql): Promise<Map<number, Record<string, number>>> {
  const rows = await sql<{ color_identity: number; deck_months: Record<string, number> }[]>`
    select color_identity, deck_months from public.corpus_identity_stats
  `;
  return new Map(rows.map((r) => [r.color_identity, r.deck_months]));
}

/** A value for a COPY text row: \N for null, everything else as text with its specials escaped. */
function copyField(value: number | string | boolean | null): string {
  if (value === null) return '\\N';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '\\N';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  return value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Streams rows into a table with COPY: millions of rows in seconds, where multi-row inserts take minutes. `table` and
 * `columns` are written into the statement, so they must be code, never input.
 */
export async function copyRows(
  db: ReservedSql,
  table: string,
  columns: readonly string[],
  rows: Iterable<readonly (number | string | boolean | null)[]>,
): Promise<number> {
  let count = 0;
  // Lines go out in chunks: one write per row would cost a stream round per row.
  const lines = (function* () {
    let chunk = '';
    for (const row of rows) {
      count++;
      chunk += `${row.map(copyField).join('\t')}\n`;
      if (chunk.length >= COPY_CHUNK_CHARS) {
        yield chunk;
        chunk = '';
      }
    }
    if (chunk.length > 0) yield chunk;
  })();
  const writable = await db.unsafe(`copy ${table} (${columns.join(', ')}) from stdin`).writable();
  await pipeline(Readable.from(lines), writable);
  return count;
}
