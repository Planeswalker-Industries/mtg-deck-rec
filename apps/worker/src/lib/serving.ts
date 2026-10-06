import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { servingSettings, type BaselineCounts, type CardFacts, type CorpusKey, type ServingSettings } from '@mtg/core/scoring';
import type { ReservedSql, Sql } from './db';

/** What the precompute worker reads to build the serving tables (T055). */

/** Rows read from commander_card_stats per round trip. */
const STATS_CURSOR_ROWS = 20_000;
/** commander_card_stats.eligible_decks is null on rows from before release-aware counting. */
const NO_ELIGIBLE_COUNT = -1;
/** COPY rows are sent in chunks of about this many characters. */
const COPY_CHUNK_CHARS = 1 << 16;

/** One key's commander_card_stats rows, as parallel arrays (a million and a half rows don't fit as objects). */
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

export async function loadServingSettings(sql: Sql): Promise<Required<ServingSettings>> {
  const [row] = await sql<{ value: unknown }[]>`select value from public.app_config where key = 'corpus'`;
  return servingSettings(row?.value);
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
