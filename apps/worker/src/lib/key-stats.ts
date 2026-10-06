import type { ReservedSql } from './db';
import {
  decksSinceRelease,
  EXCLUSIONS,
  IDENTITIES,
  resolveDeck,
  shrunkInclusion,
  type CatalogCard,
  type CorpusConfig,
  type CorpusDeck,
  type Exclusion,
} from './corpus';
import { curveBucket } from '@mtg/core/scoring';
import { copyRows } from './serving';

/**
 * Per-commander stats from collated decks: commander_keys, commander_stats and commander_card_stats. Shared by the full
 * rebuild (`aggregate:corpus`) and the precompute worker's per-commander pass (T055), so a commander's stats are the
 * same whichever wrote them.
 */

export interface KeyAggregate {
  commanders: CatalogCard[];
  identity: number;
  decks: number;
  /** Decks per source ('archidekt', 'user', ...). */
  sources: Record<string, number>;
  /** Decks by last-updated month ('YYYY-MM'). */
  months: Record<string, number>;
  /** Role tag id → cards in that role, summed over the decks. */
  roleCounts: Record<string, number>;
  /** Curve bucket ('0' to '7') → nonland cards there, summed over the decks (T062). */
  curveCounts: Record<string, number>;
  /** Lands and basic lands, summed over the decks (T062). */
  lands: number;
  basicLands: number;
  /** card id → decks running it */
  cards: Map<number, number>;
}

export interface DeckTally {
  /** Commander key ('id' or 'id:id') → its decks' counts. */
  keys: Map<string, KeyAggregate>;
  excluded: Record<Exclusion, number>;
  decksRead: number;
  eligibleDecks: number;
}

const increment = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
const bump = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1;
};

/**
 * Counts collated decks per commander key. A deck the corpus rule now refuses is skipped and counted by reason, and a
 * deck posted on two sites counts once: the same content hash from a second source is skipped. Identical decks on one
 * site are different players' decks (an unchanged precon, say), and each counts.
 */
export async function tallyDecks(
  decks: AsyncIterable<CorpusDeck>,
  catalog: ReadonlyMap<number, CatalogCard>,
  config: CorpusConfig,
  rolesByCard: ReadonlyMap<number, readonly string[]>,
  onDeck?: (decksRead: number) => Promise<void>,
): Promise<DeckTally> {
  const keys = new Map<string, KeyAggregate>();
  const excluded = Object.fromEntries(EXCLUSIONS.map((e) => [e, 0])) as Record<Exclusion, number>;
  const sourceByContent = new Map<string, string>();
  let decksRead = 0;
  let eligibleDecks = 0;

  for await (const deck of decks) {
    decksRead++;
    if (onDeck) await onDeck(decksRead);
    const resolved = resolveDeck(deck, catalog, config);
    if (!resolved.ok) {
      excluded[resolved.reason]++;
      continue;
    }
    const firstSource = sourceByContent.get(deck.contentHash);
    if (firstSource === undefined) sourceByContent.set(deck.contentHash, deck.source);
    else if (firstSource !== deck.source) {
      excluded.duplicate_across_sources++;
      continue;
    }

    const { key, commanders, identity, month, cardIds } = resolved.deck;
    let aggregate = keys.get(key);
    if (!aggregate) {
      aggregate = { commanders, identity, decks: 0, sources: {}, months: {}, roleCounts: {}, curveCounts: {}, lands: 0, basicLands: 0, cards: new Map() };
      keys.set(key, aggregate);
    }
    aggregate.decks++;
    bump(aggregate.sources, deck.source);
    bump(aggregate.months, month);
    for (const id of cardIds) {
      increment(aggregate.cards, id);
      for (const role of rolesByCard.get(id) ?? []) bump(aggregate.roleCounts, role);
      tallyShape(aggregate, catalog.get(id));
    }
    aggregate.lands += deck.basicLands;
    aggregate.basicLands += deck.basicLands;
    eligibleDecks++;
  }
  return { keys, excluded, decksRead, eligibleDecks };
}

/** One card's place in a deck's shape: a land, or a nonland card at its mana value. */
export function tallyShape(aggregate: Pick<KeyAggregate, 'curveCounts' | 'lands'>, card: Pick<CatalogCard, 'manaValue' | 'isLand'> | undefined): void {
  if (!card) return;
  if (card.isLand) aggregate.lands++;
  else bump(aggregate.curveCounts, curveBucket(card.manaValue));
}

/** Per-deck averages, to two places. */
const perDeck = (total: number, decks: number) => Math.round((total / Math.max(decks, 1)) * 100) / 100;

/** Decks per month for each colour identity, from the keys' own months. */
export function identityMonths(keys: ReadonlyMap<string, KeyAggregate>): Record<string, number>[] {
  const months = Array.from({ length: IDENTITIES }, (): Record<string, number> => ({}));
  for (const a of keys.values()) {
    const target = months[a.identity];
    if (!target) continue;
    for (const [month, n] of Object.entries(a.months)) target[month] = (target[month] ?? 0) + n;
  }
  return months;
}

export interface KeyStatRow {
  key: string;
  commander_1: number;
  commander_2: number | null;
  color_identity: number;
  slug: string;
  deck_count: number;
  source_counts: string;
  deck_months: string;
  role_profile: string;
  curve_profile: string;
  land_count: number;
  basic_land_count: number;
}

export interface CardStatRow {
  key: string;
  card_id: number;
  decks_with: number;
  eligible_decks: number;
  inclusion_shrunk: number;
  synergy: number;
}

export function keyStatRows(keys: ReadonlyMap<string, KeyAggregate>): KeyStatRow[] {
  return [...keys].map(([key, a]) => ({
    key,
    commander_1: a.commanders[0]?.id ?? 0,
    commander_2: a.commanders[1]?.id ?? null,
    color_identity: a.identity,
    slug: a.commanders.map((c) => c.slug).join('--'),
    deck_count: a.decks,
    source_counts: JSON.stringify(a.sources),
    deck_months: JSON.stringify(a.months),
    role_profile: JSON.stringify(
      Object.fromEntries(Object.entries(a.roleCounts).map(([role, cards]) => [role, Math.round((cards / a.decks) * 100) / 100])),
    ),
    curve_profile: JSON.stringify(
      Object.fromEntries(Object.entries(a.curveCounts).sort(([x], [y]) => Number(x) - Number(y)).map(([bucket, cards]) => [bucket, perDeck(cards, a.decks)])),
    ),
    land_count: perDeck(a.lands, a.decks),
    basic_land_count: perDeck(a.basicLands, a.decks),
  }));
}

/** Each key's cards: decks running them, decks updated since their release, inclusion shrunk toward the baseline p0. */
export function cardStatRows(
  keys: ReadonlyMap<string, KeyAggregate>,
  catalog: ReadonlyMap<number, CatalogCard>,
  baseline: ReadonlyMap<number, number>,
  shrinkAlpha: number,
): CardStatRow[] {
  return [...keys].flatMap(([key, a]) => {
    const sinceRelease = new Map<string | null, number>();
    return [...a.cards].map(([card_id, decks_with]) => {
      const releaseMonth = catalog.get(card_id)?.releaseMonth ?? null;
      let since = sinceRelease.get(releaseMonth);
      if (since === undefined) {
        since = decksSinceRelease(a.months, releaseMonth);
        sinceRelease.set(releaseMonth, since);
      }
      const eligible_decks = Math.max(since, decks_with);
      const p0 = baseline.get(card_id) ?? 0;
      const inclusion_shrunk = shrunkInclusion(decks_with, eligible_decks, p0, shrinkAlpha);
      return { key, card_id, decks_with, eligible_decks, inclusion_shrunk, synergy: inclusion_shrunk - p0 };
    });
  });
}

export interface GlobalStatRow {
  card_id: number;
  decks_with: number;
  eligible_decks: number;
  rate: number;
}

/**
 * Each card's baseline: the decks running it over the decks its colours allow that were updated since its release.
 * `decksWith` is per card over every counted deck; `monthsByIdentity` is decks per month for each colour identity.
 */
export function globalStatRows(
  decksWith: ReadonlyMap<number, number>,
  monthsByIdentity: readonly Record<string, number>[],
  catalog: ReadonlyMap<number, CatalogCard>,
): GlobalStatRow[] {
  const eligibleMemo = new Map<string, number>();
  const baselineDecksFor = (cardIdentity: number, releaseMonth: string | null) => {
    const memoKey = `${cardIdentity}:${releaseMonth ?? ''}`;
    let n = eligibleMemo.get(memoKey);
    if (n === undefined) {
      n = monthsByIdentity.reduce(
        (sum, months, deckIdentity) => ((cardIdentity & ~deckIdentity) === 0 ? sum + decksSinceRelease(months, releaseMonth) : sum),
        0,
      );
      eligibleMemo.set(memoKey, n);
    }
    return n;
  };
  return [...decksWith].map(([card_id, decks_with]) => {
    const card = catalog.get(card_id);
    const eligible_decks = Math.max(baselineDecksFor(card?.colorIdentity ?? 0, card?.releaseMonth ?? null), decks_with);
    return { card_id, decks_with, eligible_decks, rate: decks_with / Math.max(eligible_decks, 1) };
  });
}

/**
 * Writes card_global_stats and corpus_identity_stats where they changed, and drops baselines of cards no deck runs any
 * more. Call inside a transaction.
 */
export async function mergeBaseline(db: ReservedSql, globalRows: readonly GlobalStatRow[], monthsByIdentity: readonly Record<string, number>[]): Promise<void> {
  await db`create temp table if not exists stg_global (card_id integer primary key, decks_with integer not null, eligible_decks integer not null, rate real not null)`;
  await db`create temp table if not exists stg_identity (color_identity smallint primary key, deck_months text not null)`;
  await db`truncate stg_global, stg_identity`;
  await copyRows(db, 'stg_global', ['card_id', 'decks_with', 'eligible_decks', 'rate'], globalRows.map((r) => [r.card_id, r.decks_with, r.eligible_decks, r.rate]));
  await copyRows(db, 'stg_identity', ['color_identity', 'deck_months'], monthsByIdentity.map((months, identity) => [identity, JSON.stringify(months)]));
  await db`
    delete from public.card_global_stats g
    where not exists (select 1 from stg_global s where s.card_id = g.card_id)
  `;
  await db`
    insert into public.card_global_stats as g (card_id, decks_with, eligible_decks, rate)
    select card_id, decks_with, eligible_decks, least(rate, 1) from stg_global
    on conflict (card_id) do update set
      decks_with = excluded.decks_with,
      eligible_decks = excluded.eligible_decks,
      rate = excluded.rate,
      computed_at = now()
    where g.decks_with is distinct from excluded.decks_with or g.eligible_decks is distinct from excluded.eligible_decks
  `;
  await db`
    insert into public.corpus_identity_stats as ci (color_identity, deck_months)
    select color_identity, deck_months::jsonb from stg_identity
    on conflict (color_identity) do update set deck_months = excluded.deck_months, computed_at = now()
    where ci.deck_months is distinct from excluded.deck_months
  `;
}

const KEY_COLUMNS = [
  'key', 'commander_1', 'commander_2', 'color_identity', 'slug', 'deck_count', 'source_counts', 'deck_months', 'role_profile',
  'curve_profile', 'land_count', 'basic_land_count',
];
const CARD_COLUMNS = ['key', 'card_id', 'decks_with', 'eligible_decks', 'inclusion_shrunk', 'synergy'];

/**
 * Writes staged key stats: new keys get their commander_keys row, then each staged key's commander_stats and
 * commander_card_stats rows that changed. With `everyKey`, the stage is the whole corpus, so stats of keys missing from
 * it go; otherwise only the staged keys (and the `emptied` ones, commanders whose decks are all gone) are touched.
 * Call inside a transaction on the connection that staged.
 */
export async function mergeKeyStats(
  db: ReservedSql,
  keyRows: readonly KeyStatRow[],
  cardRows: readonly CardStatRow[],
  { everyKey, emptied = [] }: { everyKey: boolean; emptied?: readonly (readonly [number, number])[] },
): Promise<{ cardRowsWritten: number; cardRowsRemoved: number }> {
  await db`
    create temp table if not exists stg_keys (
      key text primary key,
      commander_1 integer not null,
      commander_2 integer,
      color_identity smallint not null,
      slug text not null,
      deck_count integer not null,
      source_counts text not null,
      deck_months text not null,
      role_profile text not null,
      curve_profile text not null,
      land_count real not null,
      basic_land_count real not null
    )
  `;
  await db`
    create temp table if not exists stg_card_stats (
      key text not null,
      card_id integer not null,
      decks_with integer not null,
      eligible_decks integer not null,
      inclusion_shrunk real not null,
      synergy real not null
    )
  `;
  await db`create temp table if not exists stg_emptied (commander_1 integer not null, commander_2 integer not null)`;
  await db`truncate stg_keys, stg_card_stats, stg_emptied`;
  await copyRows(db, 'stg_keys', KEY_COLUMNS, keyRows.map((r) => KEY_COLUMNS.map((c) => r[c as keyof KeyStatRow])));
  await copyRows(db, 'stg_card_stats', CARD_COLUMNS, cardRows.map((r) => CARD_COLUMNS.map((c) => r[c as keyof CardStatRow])));
  await copyRows(db, 'stg_emptied', ['commander_1', 'commander_2'], emptied.map(([a, b]) => [a, b]));

  await db`
    insert into public.commander_keys as k (commander_1, commander_2, color_identity, slug)
    select commander_1, commander_2, color_identity, slug from stg_keys
    on conflict (commander_1, (coalesce(commander_2, 0))) do update
      set color_identity = excluded.color_identity, slug = excluded.slug
      where k.color_identity is distinct from excluded.color_identity or k.slug is distinct from excluded.slug
  `;
  await db`drop table if exists stg_key_ids`;
  await db`
    create temp table stg_key_ids as
    select s.key, k.id
    from stg_keys s
    join public.commander_keys k on k.commander_1 = s.commander_1 and coalesce(k.commander_2, 0) = coalesce(s.commander_2, 0)
  `;
  // Keys whose stats this merge owns: every key, or the staged and emptied ones.
  await db`drop table if exists stg_scope`;
  await db`
    create temp table stg_scope as
    select id from stg_key_ids
    union
    select k.id from public.commander_keys k join stg_emptied e on e.commander_1 = k.commander_1 and e.commander_2 = coalesce(k.commander_2, 0)
  `;

  await db`
    delete from public.commander_stats cs
    where (${everyKey} or exists (select 1 from stg_scope s where s.id = cs.commander_key_id))
      and not exists (select 1 from stg_key_ids i where i.id = cs.commander_key_id)
  `;
  // bracket_counts stays empty: the bracket a deck's author declares is not used (owner decision 2026-10-05), and
  // brackets our estimator assigns come with the bracket rules (T060).
  await db`
    insert into public.commander_stats as cs
      (commander_key_id, deck_count, source_counts, bracket_counts, deck_months, role_profile, curve_profile, land_count, basic_land_count)
    select i.id, s.deck_count, s.source_counts::jsonb, '{}'::jsonb, s.deck_months::jsonb, s.role_profile::jsonb,
           s.curve_profile::jsonb, s.land_count, s.basic_land_count
    from stg_keys s
    join stg_key_ids i on i.key = s.key
    on conflict (commander_key_id) do update set
      deck_count = excluded.deck_count,
      source_counts = excluded.source_counts,
      bracket_counts = excluded.bracket_counts,
      deck_months = excluded.deck_months,
      role_profile = excluded.role_profile,
      curve_profile = excluded.curve_profile,
      land_count = excluded.land_count,
      basic_land_count = excluded.basic_land_count,
      computed_at = now()
    where (cs.deck_count, cs.source_counts, cs.bracket_counts, cs.deck_months, cs.role_profile, cs.curve_profile, cs.land_count, cs.basic_land_count)
      is distinct from (excluded.deck_count, excluded.source_counts, excluded.bracket_counts, excluded.deck_months, excluded.role_profile,
                        excluded.curve_profile, excluded.land_count, excluded.basic_land_count)
  `;

  await db`drop table if exists stg_commander_card_rows`;
  await db`
    create temp table stg_commander_card_rows (
      commander_key_id integer not null,
      card_id integer not null,
      decks_with integer not null,
      eligible_decks integer not null,
      inclusion_shrunk real not null,
      synergy real not null,
      primary key (commander_key_id, card_id)
    )
  `;
  await db`
    insert into stg_commander_card_rows
    select i.id, s.card_id, s.decks_with, s.eligible_decks, s.inclusion_shrunk, s.synergy
    from stg_card_stats s
    join stg_key_ids i on i.key = s.key
  `;
  const [removed] = await db<{ n: number }[]>`
    with removed as (
      delete from public.commander_card_stats cc
      where (${everyKey} or exists (select 1 from stg_scope s where s.id = cc.commander_key_id))
        and not exists (
          select 1 from stg_commander_card_rows s where s.commander_key_id = cc.commander_key_id and s.card_id = cc.card_id
        )
      returning 1
    )
    select count(*)::int as n from removed
  `;
  // Only rows that change are written; every rewritten row leaves a dead version behind. Rates are floats rebuilt
  // from scratch, and a few new decks nudge every card's baseline, so shrunk inclusion and synergy moving by less
  // than 0.001 don't count as changes (0.3% of the synergy scale).
  const [written] = await db<{ n: number }[]>`
    with written as (
      insert into public.commander_card_stats as cc (commander_key_id, card_id, decks_with, eligible_decks, inclusion_shrunk, synergy)
      select commander_key_id, card_id, decks_with, eligible_decks, inclusion_shrunk, synergy from stg_commander_card_rows
      on conflict (commander_key_id, card_id) do update set
        decks_with = excluded.decks_with,
        eligible_decks = excluded.eligible_decks,
        inclusion_shrunk = excluded.inclusion_shrunk,
        synergy = excluded.synergy
      where cc.decks_with is distinct from excluded.decks_with
         or cc.eligible_decks is distinct from excluded.eligible_decks
         or abs(cc.inclusion_shrunk - excluded.inclusion_shrunk) >= 0.001
         or abs(cc.synergy - excluded.synergy) >= 0.001
      returning 1
    )
    select count(*)::int as n from written
  `;
  return { cardRowsWritten: written?.n ?? 0, cardRowsRemoved: removed?.n ?? 0 };
}
