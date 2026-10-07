import { createHash } from 'node:crypto';
import { checkCorpusDeck, CORPUS_EXCLUSIONS, type CorpusExclusion } from '@mtg/core/commander';
import { normalizeName, SPELLBOOK_BRACKET_TAGS } from '@mtg/core/parse';
import { commanderFacts, loadCatalog, type CatalogCard } from '../lib/corpus';
import { connect, reserve, type Sql } from '../lib/db';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/**
 * The collator (T054): every raw source → corpus, with one set of rules. docs/roadmap/card-graph-plan.md, "Collator".
 *
 * - Decks (Archidekt and Moxfield raw, players' saved decks) → corpus.decks, when they pass the corpus rule
 *   (`checkCorpusDeck`). Cards are looked up in SQL; the rule runs here.
 * - EDHREC's raw pages → corpus.edhrec_commanders and corpus.edhrec_commander_cards.
 * - Commander Spellbook's raw combos → corpus.spellbook_combos.
 *
 * Each source is collated in its own transaction, which also records how far it got in corpus.collate_state, so a
 * source that fails leaves the next collation to start from the same place. Writes touch only rows that differ. A
 * source whose collation would remove more than `collateMaxRemovedShare` of its corpus rows refuses (unless forced),
 * so a raw table emptied by mistake can't empty the corpus. corpus.decks marks changed commanders dirty itself.
 */

const DECK_SOURCES = ['archidekt', 'moxfield', 'user'] as const;
type DeckSource = (typeof DECK_SOURCES)[number];
export const COLLATE_SOURCES = [...DECK_SOURCES, 'edhrec', 'spellbook'] as const;
export type CollateSource = (typeof COLLATE_SOURCES)[number];

/**
 * Raw deck rows written this long before the last collation started are read again: a write in flight when it started
 * commits later with an earlier timestamp. Re-reading a row costs a comparison; missing one would cost the deck.
 */
const RAW_OVERLAP = '15 minutes';
const DECK_CURSOR_ROWS = 500;
const STAGE_BATCH = 2000; // 10 columns a row, well under Postgres's 65,535 parameters
const NAME_BATCH = 5000;
const HEARTBEAT_EVERY = 5000; // decks between heartbeats
/** Fewer removals than this never trip the share gate: a handful of players deleting decks is ordinary churn. */
const MIN_REMOVALS_GATED = 25;
/** The gate's share when app_config.corpus doesn't set collateMaxRemovedShare. */
const DEFAULT_MAX_REMOVED_SHARE = 0.1;
/** EDHREC and Spellbook fetch runs, as sync_runs names their jobs. */
const FETCH_JOB = { edhrec: 'edhrec_pages', spellbook: 'spellbook_combos' } as const;

class SanityError extends Error {}

interface CollateState {
  raw_since: Date | null;
  fetch_run_id: string | null;
  catalog_epoch: string;
}

interface Context {
  sql: Sql;
  force: boolean;
  epoch: number;
  maxRemovedShare: number;
  metrics: SyncMetrics;
}

/** Adds `values` to the run's metrics under `source.` names. */
const record = (ctx: Context, source: CollateSource, values: Record<string, number>) => {
  for (const [key, value] of Object.entries(values)) ctx.metrics[`${source}.${key}`] = value;
};

/** Refuses a collation that would take too much of a source away. */
function gate(ctx: Context, source: CollateSource, removed: number, existing: number): void {
  if (ctx.force || removed < MIN_REMOVALS_GATED || removed <= existing * ctx.maxRemovedShare) return;
  throw new SanityError(`${source}: would remove ${removed} of ${existing} corpus rows`);
}

const count = async (rows: Promise<{ n: number }[]>) => (await rows)[0]?.n ?? 0;

// === decks ===

interface DeckFacts {
  source_deck_id: string;
  user_deck_id: string | null;
  deck_size: number;
  month: string;
  /** In the source's order; null where the catalog has no live card for one. */
  commander_ids: (number | null)[] | null;
  card_ids: number[];
  basic_lands: number;
  unresolved_cards: number;
  cards_identity: number;
}

interface StagedDeck {
  source_deck_id: string;
  user_deck_id: string | null;
  included: boolean;
  commander_card_ids: number[] | null;
  color_identity: number | null;
  card_ids: number[] | null;
  basic_lands: number | null;
  updated_month: string | null;
  content_hash: Buffer | null;
}

/** Over commanders, cards and basic land copies: the same deck posted on two sites hashes the same. */
const deckHash = (commanderIds: number[], cardIds: number[], basicLands: number) =>
  createHash('md5').update(`${commanderIds.join(',')}|${cardIds.join(',')}|${basicLands}`).digest();

/**
 * The decks of one source to look at, with their cards looked up in the catalog: those written since `since` (all of
 * them when null), plus with `retry` every deck the corpus doesn't hold, since a newer catalog may resolve it now.
 * The filter is built from fragments rather than one OR with parameters, so an ordinary run reads by the raw table's
 * `fetched_at` index; only a retry (a newer catalog) reads every deck.
 */
function deckFacts(sql: Sql, source: DeckSource, since: Date | null, retry: boolean) {
  const written = (column: ReturnType<Sql>) =>
    since === null ? sql`true` : sql`${column} >= ${since}::timestamptz - ${RAW_OVERLAP}::interval`;
  if (source === 'user') {
    const lacking = retry
      ? sql`not exists (select 1 from corpus.decks k where k.source = 'user' and k.source_deck_id = d.id::text)`
      : sql`false`;
    return sql<DeckFacts[]>`
      select d.id::text as source_deck_id, d.id::text as user_deck_id, d.card_count as deck_size,
             to_char(d.updated_at, 'YYYY-MM') as month, cmd.ids as commander_ids,
             coalesce(rest.card_ids, '{}') as card_ids, coalesce(rest.basic_lands, 0)::int as basic_lands,
             coalesce(rest.unresolved, 0)::int as unresolved_cards, coalesce(rest.identity, 0)::int as cards_identity
      from public.decks d
      cross join lateral (
        select array_agg(c.id order by dc.card_id) as ids
        from public.deck_cards dc
        left join public.cards c on c.id = dc.card_id and c.deleted_at is null
        where dc.deck_id = d.id and dc.section = 'commander'
      ) cmd
      cross join lateral (
        select array_agg(distinct c.id order by c.id) filter (where c.id is not null and not c.is_basic_land) as card_ids,
               sum(dc.quantity) filter (where c.is_basic_land) as basic_lands,
               count(*) filter (where c.id is null) as unresolved,
               bit_or(c.color_identity) as identity
        from public.deck_cards dc
        left join public.cards c on c.id = dc.card_id and c.deleted_at is null
        where dc.deck_id = d.id and dc.section = 'main'
      ) rest
      where ${written(sql`d.updated_at`)} or ${lacking}
    `.cursor(DECK_CURSOR_ROWS);
  }
  const lacking = retry
    ? sql`not exists (select 1 from corpus.decks k where k.source = d.source and k.source_deck_id = d.source_deck_id)`
    : sql`false`;
  return sql<DeckFacts[]>`
    select d.source_deck_id, null as user_deck_id, d.deck_size, to_char(d.last_updated_at, 'YYYY-MM') as month,
           cmd.ids as commander_ids,
           coalesce(rest.card_ids, '{}') as card_ids, coalesce(rest.basic_lands, 0)::int as basic_lands,
           coalesce(rest.unresolved, 0)::int as unresolved_cards, coalesce(rest.identity, 0)::int as cards_identity
    from crawl.decks d
    cross join lateral (
      select array_agg(c.id order by o.ord) as ids
      from unnest(d.commanders) with ordinality as o (oracle_id, ord)
      left join public.cards c on c.oracle_id = o.oracle_id and c.deleted_at is null
    ) cmd
    cross join lateral (
      select array_agg(distinct c.id order by c.id) filter (where c.id is not null and not c.is_basic_land) as card_ids,
             sum(u.quantity) filter (where c.is_basic_land) as basic_lands,
             count(*) filter (where c.id is null) as unresolved,
             bit_or(c.color_identity) as identity
      from unnest(d.card_oracle_ids, d.quantities) as u (oracle_id, quantity)
      left join public.cards c on c.oracle_id = u.oracle_id and c.deleted_at is null
    ) rest
    where d.source = ${source} and (${written(sql`d.fetched_at`)} or ${lacking})
  `.cursor(DECK_CURSOR_ROWS);
}

/** One deck source → corpus.decks. */
async function collateDecks(ctx: Context, runId: number, source: DeckSource, catalog: Map<number, CatalogCard>, state: CollateState | undefined) {
  const { sql } = ctx;
  // Forced, every deck is read again; otherwise those written since the last collation, and on a newer catalog every
  // deck the corpus lacks.
  const since = ctx.force ? null : (state?.raw_since ?? null);
  const retry = !state || Number(state.catalog_epoch) < ctx.epoch;
  // The next collation reads raw rows written since this; taken before the read, so nothing written during it is missed.
  const [startRow] = await sql<{ started: Date }[]>`select now() as started`;
  const started = startRow?.started ?? new Date();
  const excluded = Object.fromEntries(CORPUS_EXCLUSIONS.map((reason) => [reason, 0])) as Record<CorpusExclusion, number>;
  let read = 0;
  let included = 0;

  const db = await reserve(sql);
  try {
    await db`
      create temp table stg_decks (
        source_deck_id text primary key,
        user_deck_id uuid,
        included boolean not null,
        commander_card_ids integer[],
        color_identity smallint,
        card_ids integer[],
        basic_lands smallint,
        updated_month date,
        content_hash bytea
      )
    `;
    for await (const rows of deckFacts(sql, source, since, retry)) {
      const staged: StagedDeck[] = rows.map((row) => {
        const check = checkCorpusDeck({
          commanders: (row.commander_ids ?? []).map((id) => {
            const card = id === null ? undefined : catalog.get(id);
            return card && commanderFacts(card);
          }),
          unresolvedCards: row.unresolved_cards,
          cardsIdentity: row.cards_identity,
          deckSize: row.deck_size,
        });
        const base = { source_deck_id: row.source_deck_id, user_deck_id: row.user_deck_id };
        if (!check.ok) {
          excluded[check.reason]++;
          return { ...base, included: false, commander_card_ids: null, color_identity: null, card_ids: null, basic_lands: null, updated_month: null, content_hash: null };
        }
        included++;
        return {
          ...base,
          included: true,
          commander_card_ids: check.commanderIds,
          color_identity: check.identity,
          card_ids: row.card_ids,
          basic_lands: row.basic_lands,
          updated_month: `${row.month}-01`,
          content_hash: deckHash(check.commanderIds, row.card_ids, row.basic_lands),
        };
      });
      for (let i = 0; i < staged.length; i += STAGE_BATCH) {
        await db`
          insert into stg_decks ${db(
            staged.slice(i, i + STAGE_BATCH),
            'source_deck_id',
            'user_deck_id',
            'included',
            'commander_card_ids',
            'color_identity',
            'card_ids',
            'basic_lands',
            'updated_month',
            'content_hash',
          )}
        `;
      }
      const before = read;
      read += rows.length;
      if (Math.floor(read / HEARTBEAT_EVERY) > Math.floor(before / HEARTBEAT_EVERY)) await heartbeat(sql, runId, read);
    }

    // Temp tables have no statistics until analyzed, and the merge's plans depend on how many rows they hold.
    await db`analyze stg_decks`;
    await db`begin`;
    try {
      const existing = await count(db<{ n: number }[]>`select count(*)::int as n from corpus.decks where source = ${source}`);
      const removed = await count(db<{ n: number }[]>`
        with removed as (
          delete from corpus.decks c using stg_decks s
          where c.source = ${source} and c.source_deck_id = s.source_deck_id and not s.included
          returning 1
        )
        select count(*)::int as n from removed
      `);
      // A player's deleted deck leaves through its foreign key; a crawled deck gone from raw leaves here.
      const gone =
        source === 'user'
          ? 0
          : await count(db<{ n: number }[]>`
              with gone as (
                delete from corpus.decks c
                where c.source = ${source}
                  and not exists (select 1 from crawl.decks r where r.source = ${source} and r.source_deck_id = c.source_deck_id)
                returning 1
              )
              select count(*)::int as n from gone
            `);
      gate(ctx, source, removed + gone, existing);
      const written = await count(db<{ n: number }[]>`
        with written as (
          insert into corpus.decks as c (
            source, source_deck_id, user_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month,
            content_hash
          )
          select ${source}, source_deck_id, user_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month,
                 content_hash
          from stg_decks where included
          on conflict (source, source_deck_id) do update set
            user_deck_id = excluded.user_deck_id,
            commander_card_ids = excluded.commander_card_ids,
            color_identity = excluded.color_identity,
            card_ids = excluded.card_ids,
            basic_lands = excluded.basic_lands,
            updated_month = excluded.updated_month,
            content_hash = excluded.content_hash,
            collated_at = now()
          where (c.content_hash, c.updated_month, c.user_deck_id) is distinct from (excluded.content_hash, excluded.updated_month, excluded.user_deck_id)
          returning 1
        )
        select count(*)::int as n from written
      `);
      await db`
        insert into corpus.collate_state (source, raw_since, catalog_epoch, collated_at)
        values (${source}, ${started}, ${ctx.epoch}, now())
        on conflict (source) do update set raw_since = excluded.raw_since, catalog_epoch = excluded.catalog_epoch, collated_at = now()
      `;
      await db`commit`;
      record(ctx, source, { read, included, written, removed, gone, ...prefixed('excluded', excluded) });
      console.log(
        `corpus_collate: ${source}: ${read} decks read, ${included} pass the rule; ${written} written, ${removed + gone} removed` +
          (retry ? ' (retried every deck the corpus lacks: the catalog changed)' : ''),
      );
      return { read, changed: written + removed + gone };
    } catch (err) {
      await db`rollback`.catch(() => {});
      throw err;
    }
  } finally {
    await db`drop table if exists stg_decks`.catch(() => {});
    db.release();
  }
}

const prefixed = (prefix: string, values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v > 0).map(([k, v]) => [`${prefix}.${k}`, v]));

// === EDHREC ===

/** normalized name → the one live card it names, or nothing when it names none or several. */
async function loadNameResolver(sql: Sql): Promise<(name: string) => number | null> {
  const rows = await sql<{ name_normalized: string; card_id: number }[]>`
    select n.name_normalized, n.card_id from public.card_names n join public.cards c on c.id = n.card_id where c.deleted_at is null
  `;
  const byName = new Map<string, Set<number>>();
  for (const r of rows) {
    let ids = byName.get(r.name_normalized);
    if (!ids) byName.set(r.name_normalized, (ids = new Set()));
    ids.add(r.card_id);
  }
  return (name) => {
    const ids = byName.get(normalizeName(name));
    return ids?.size === 1 ? ([...ids][0] ?? null) : null;
  };
}

interface RawPage {
  slug: string;
  names: string[];
  deck_count: number;
  fetched_at: Date;
  /** The page's own printing's live card, when it names one. */
  printing_card_id: number | null;
}

interface StagedPage {
  slug: string;
  commander_1: number;
  commander_2: number | null;
  deck_count: number;
  fetched_at: Date;
}

/**
 * A page's commanders, ascending: one card (both faces of a double-faced card resolve to it) or a pair. Every name must
 * match one card, since a pair with an unmatched partner would otherwise pass for the other partner alone; the page's
 * printing only stands in for a page that names a single card.
 */
function pageCommanders(page: RawPage, byName: (name: string) => number | null): number[] | null {
  const ids = page.names.map(byName);
  if (ids.every((id): id is number => id !== null)) {
    const distinct = [...new Set(ids)].sort((a, b) => a - b);
    return distinct.length >= 1 && distinct.length <= 2 ? distinct : null;
  }
  return page.names.length === 1 && page.printing_card_id !== null ? [page.printing_card_id] : null;
}

/** EDHREC's raw pages → corpus.edhrec_commanders, corpus.edhrec_commander_cards. */
async function collateEdhrec(ctx: Context, fetchRunId: number) {
  const { sql } = ctx;
  const byName = await loadNameResolver(sql);
  const pages = await sql<RawPage[]>`
    select r.slug, r.names, r.deck_count, r.fetched_at, pc.id as printing_card_id
    from edhrec.commanders r
    left join public.printings p on p.id = r.printing_id and p.deleted_at is null
    left join public.cards pc on pc.id = p.card_id and pc.deleted_at is null
    order by r.slug
  `;
  const counts = { pages: pages.length, noDecks: 0, unresolvedCommander: 0, duplicatePair: 0 };
  const byPair = new Map<string, StagedPage>();
  for (const page of pages) {
    if (page.deck_count === 0) {
      counts.noDecks++;
      continue;
    }
    const ids = pageCommanders(page, byName);
    if (!ids) {
      counts.unresolvedCommander++;
      continue;
    }
    const pair = ids.join(':');
    const seen = byPair.get(pair);
    // A flavor-name page duplicates its card's page: keep the one with the most decks (pages come in slug order).
    if (seen) {
      counts.duplicatePair++;
      if (seen.deck_count >= page.deck_count) continue;
    }
    byPair.set(pair, { slug: page.slug, commander_1: ids[0] as number, commander_2: ids[1] ?? null, deck_count: page.deck_count, fetched_at: page.fetched_at });
  }

  const names = await sql<{ name: string }[]>`select distinct name from edhrec.commander_cards`;
  const resolvedNames = names.flatMap(({ name }) => {
    const cardId = byName(name);
    return cardId === null ? [] : [{ name, card_id: cardId }];
  });

  const db = await reserve(sql);
  try {
    await db`create temp table stg_pages (slug text primary key, commander_1 integer not null, commander_2 integer, deck_count integer not null, fetched_at timestamptz not null)`;
    await db`create temp table stg_names (name text primary key, card_id integer not null)`;
    const staged = [...byPair.values()];
    for (let i = 0; i < staged.length; i += STAGE_BATCH) {
      await db`insert into stg_pages ${db(staged.slice(i, i + STAGE_BATCH), 'slug', 'commander_1', 'commander_2', 'deck_count', 'fetched_at')}`;
    }
    for (let i = 0; i < resolvedNames.length; i += NAME_BATCH) {
      await db`insert into stg_names ${db(resolvedNames.slice(i, i + NAME_BATCH), 'name', 'card_id')}`;
    }
    await db`analyze stg_pages`;
    await db`analyze stg_names`;

    await db`begin`;
    try {
      const existing = await count(db<{ n: number }[]>`select count(*)::int as n from corpus.edhrec_commanders`);
      // Commanders whose EDHREC numbers changed, for the precompute worker.
      await db`create temp table stg_dirty (commander_1 integer not null, commander_2 integer not null) on commit drop`;
      const removed = await count(db<{ n: number }[]>`
        with removed as (
          delete from corpus.edhrec_commanders e where not exists (select 1 from stg_pages s where s.slug = e.slug)
          returning e.commander_1, e.commander_2
        ), noted as (insert into stg_dirty select commander_1, coalesce(commander_2, 0) from removed)
        select count(*)::int as n from removed
      `);
      gate(ctx, 'edhrec', removed, existing);
      // A page whose commanders resolve differently now starts over, so its pair can't collide under the unique index.
      await db`
        with repaired as (
          delete from corpus.edhrec_commanders e using stg_pages s
          where e.slug = s.slug and (e.commander_1, coalesce(e.commander_2, 0)) is distinct from (s.commander_1, coalesce(s.commander_2, 0))
          returning e.commander_1, e.commander_2
        )
        insert into stg_dirty select commander_1, coalesce(commander_2, 0) from repaired
      `;
      const pagesWritten = await count(db<{ n: number }[]>`
        with written as (
          insert into corpus.edhrec_commanders as e (slug, commander_1, commander_2, deck_count, fetched_at)
          select slug, commander_1, commander_2, deck_count, fetched_at from stg_pages
          on conflict (slug) do update set deck_count = excluded.deck_count, fetched_at = excluded.fetched_at
          where (e.deck_count, e.fetched_at) is distinct from (excluded.deck_count, excluded.fetched_at)
          returning e.commander_1, e.commander_2
        ), noted as (insert into stg_dirty select commander_1, coalesce(commander_2, 0) from written)
        select count(*)::int as n from written
      `);
      // The lowest inclusion each page lists, over every row it lists: an unlisted card is below it.
      await db`
        update corpus.edhrec_commanders e set listed_floor = f.floor
        from (select slug, min(decks_with::real / potential_decks) as floor from edhrec.commander_cards group by slug) f
        where f.slug = e.slug and e.listed_floor is distinct from f.floor
      `;
      // Each listed card by the printing the page shows, then by its name; one row per card, the highest count kept.
      await db`
        create temp table stg_cards on commit drop as
        select distinct on (e.id, r.card_id) e.id as edhrec_commander_id, r.card_id, r.decks_with, r.potential_decks, r.synergy
        from (
          select cc.slug, coalesce(pc.id, n.card_id) as card_id, cc.decks_with, cc.potential_decks, cc.synergy
          from edhrec.commander_cards cc
          left join public.printings p on p.id = cc.printing_id and p.deleted_at is null
          left join public.cards pc on pc.id = p.card_id and pc.deleted_at is null
          left join stg_names n on n.name = cc.name
        ) r
        join corpus.edhrec_commanders e on e.slug = r.slug
        where r.card_id is not null
        order by e.id, r.card_id, r.decks_with desc
      `;
      await db`alter table stg_cards add primary key (edhrec_commander_id, card_id)`;
      await db`analyze stg_cards`;
      const cardsRemoved = await count(db<{ n: number }[]>`
        with removed as (
          delete from corpus.edhrec_commander_cards x
          where not exists (select 1 from stg_cards s where s.edhrec_commander_id = x.edhrec_commander_id and s.card_id = x.card_id)
          returning x.edhrec_commander_id
        ), noted as (
          insert into stg_dirty
          select e.commander_1, coalesce(e.commander_2, 0) from corpus.edhrec_commanders e where e.id in (select edhrec_commander_id from removed)
        )
        select count(*)::int as n from removed
      `);
      const cardsWritten = await count(db<{ n: number }[]>`
        with written as (
          insert into corpus.edhrec_commander_cards as x (edhrec_commander_id, card_id, decks_with, potential_decks, synergy)
          select edhrec_commander_id, card_id, decks_with, potential_decks, synergy from stg_cards
          on conflict (edhrec_commander_id, card_id) do update set
            decks_with = excluded.decks_with, potential_decks = excluded.potential_decks, synergy = excluded.synergy
          where (x.decks_with, x.potential_decks, x.synergy) is distinct from (excluded.decks_with, excluded.potential_decks, excluded.synergy)
          returning x.edhrec_commander_id
        ), noted as (
          insert into stg_dirty
          select e.commander_1, coalesce(e.commander_2, 0) from corpus.edhrec_commanders e where e.id in (select edhrec_commander_id from written)
        )
        select count(*)::int as n from written
      `);
      await db`
        insert into corpus.dirty_commanders (commander_1, commander_2)
        select distinct commander_1, commander_2 from stg_dirty
        on conflict (commander_1, commander_2) do update set seq = nextval('corpus.dirty_commanders_seq')
      `;
      const [rows] = await db<{ card_rows: number; listed: number }[]>`
        select (select count(*)::int from stg_cards) as card_rows, (select count(*)::int from edhrec.commander_cards) as listed
      `;
      await db`
        insert into corpus.collate_state (source, fetch_run_id, catalog_epoch, collated_at)
        values ('edhrec', ${fetchRunId}, ${ctx.epoch}, now())
        on conflict (source) do update set fetch_run_id = excluded.fetch_run_id, catalog_epoch = excluded.catalog_epoch, collated_at = now()
      `;
      await db`commit`;
      const cardRows = rows?.card_rows ?? 0;
      record(ctx, 'edhrec', {
        ...counts,
        commanders: staged.length,
        pagesWritten,
        pagesRemoved: removed,
        cardRows,
        listedRows: rows?.listed ?? 0,
        cardsWritten,
        cardsRemoved,
      });
      console.log(
        `corpus_collate: edhrec: ${pages.length} pages → ${staged.length} commanders, ${cardRows} card rows of ${rows?.listed ?? 0} listed; ` +
          `${pagesWritten} pages and ${cardsWritten} card rows written, ${removed} pages and ${cardsRemoved} card rows removed ` +
          `(skipped: ${counts.noDecks} with no decks, ${counts.unresolvedCommander} unresolved, ${counts.duplicatePair} duplicate pairs)`,
      );
      return { read: pages.length, changed: pagesWritten + removed + cardsWritten + cardsRemoved };
    } catch (err) {
      await db`rollback`.catch(() => {});
      throw err;
    }
  } finally {
    await db`drop table if exists stg_pages, stg_names`.catch(() => {});
    db.release();
  }
}

// === Spellbook ===

/** Spellbook's bracket tags as the minimum bracket each allows; banned ones map to null and are left out. */
const BRACKET_TAGS = Object.entries(SPELLBOOK_BRACKET_TAGS).map(([tag, { bracket }]) => ({ tag, bracket }));
/** Result statuses: standalone and contextual results are kept, hidden chaining steps dropped. */
const RESULT_STATUSES = { standalone: 'S', contextual: 'C', hidden: 'H' } as const;

/** Spellbook's raw combos → corpus.spellbook_combos. Resolution is a join on oracle ids, so it all runs in SQL. */
async function collateSpellbook(ctx: Context, fetchRunId: number) {
  const { sql } = ctx;
  const db = await reserve(sql);
  try {
    await db`begin`;
    try {
      await db`
        create temp table stg_combos on commit drop as
        select s.variant_id, r.card_ids, coalesce(r.commander_card_ids, '{}') as commander_card_ids, s.template_names,
               coalesce(f.results, '{}') as results, coalesce(f.contextual_results, '{}') as contextual_results,
               b.bracket as min_bracket, coalesce(r.identity, 0)::smallint as color_identity, s.mana_value_needed,
               r.unresolved, f.unknown_status, b.tag is null as unknown_tag, b.tag is not null and b.bracket is null as banned
        from spellbook.combos s
        cross join lateral (
          select array_agg(c.id order by c.id) as card_ids,
                 array_agg(c.id order by c.id) filter (where o.oracle_id = any (s.commander_oracle_ids)) as commander_card_ids,
                 count(*) filter (where c.id is null)::int as unresolved,
                 bit_or(c.color_identity) as identity
          from unnest(s.card_oracle_ids) as o (oracle_id)
          left join public.cards c on c.oracle_id = o.oracle_id and c.deleted_at is null
        ) r
        cross join lateral (
          select array_agg(fe.name order by fe.id) filter (where fe.status = ${RESULT_STATUSES.standalone}) as results,
                 array_agg(fe.name order by fe.id) filter (where fe.status = ${RESULT_STATUSES.contextual}) as contextual_results,
                 count(*) filter (
                   where fe.id is null
                      or fe.status not in (${RESULT_STATUSES.standalone}, ${RESULT_STATUSES.contextual}, ${RESULT_STATUSES.hidden})
                 )::int as unknown_status
          from unnest(s.feature_ids) as i (id)
          left join spellbook.features fe on fe.id = i.id
        ) f
        left join unnest(${BRACKET_TAGS.map((b) => b.tag)}::text[], ${BRACKET_TAGS.map((b) => b.bracket)}::smallint[]) as b (tag, bracket)
          on b.tag = s.bracket_tag
      `;
      const [counts] = await db<{ combos: number; unresolved: number; unknown_tag: number; unknown_status: number; banned: number }[]>`
        select count(*)::int as combos,
               count(*) filter (where unresolved > 0)::int as unresolved,
               count(*) filter (where unresolved = 0 and unknown_tag)::int as unknown_tag,
               count(*) filter (where unresolved = 0 and not unknown_tag and unknown_status > 0)::int as unknown_status,
               count(*) filter (where unresolved = 0 and not unknown_tag and unknown_status = 0 and banned)::int as banned
        from stg_combos
      `;
      await db`delete from stg_combos where unresolved > 0 or unknown_tag or unknown_status > 0 or banned`;
      await db`alter table stg_combos add primary key (variant_id)`;
      await db`analyze stg_combos`;
      const existing = await count(db<{ n: number }[]>`select count(*)::int as n from corpus.spellbook_combos`);
      const removed = await count(db<{ n: number }[]>`
        with removed as (
          delete from corpus.spellbook_combos c where not exists (select 1 from stg_combos s where s.variant_id = c.variant_id)
          returning 1
        )
        select count(*)::int as n from removed
      `);
      gate(ctx, 'spellbook', removed, existing);
      const written = await count(db<{ n: number }[]>`
        with written as (
          insert into corpus.spellbook_combos as c (
            variant_id, card_ids, commander_card_ids, template_names, results, contextual_results, min_bracket, color_identity,
            mana_value_needed
          )
          select variant_id, card_ids, commander_card_ids, template_names, results, contextual_results, min_bracket, color_identity,
                 mana_value_needed
          from stg_combos
          on conflict (variant_id) do update set
            card_ids = excluded.card_ids, commander_card_ids = excluded.commander_card_ids, template_names = excluded.template_names,
            results = excluded.results, contextual_results = excluded.contextual_results, min_bracket = excluded.min_bracket,
            color_identity = excluded.color_identity, mana_value_needed = excluded.mana_value_needed
          where (c.card_ids, c.commander_card_ids, c.template_names, c.results, c.contextual_results, c.min_bracket,
                 c.color_identity, c.mana_value_needed)
            is distinct from (excluded.card_ids, excluded.commander_card_ids, excluded.template_names, excluded.results,
                 excluded.contextual_results, excluded.min_bracket, excluded.color_identity, excluded.mana_value_needed)
          returning 1
        )
        select count(*)::int as n from written
      `);
      const kept = await count(db<{ n: number }[]>`select count(*)::int as n from stg_combos`);
      await db`
        insert into corpus.collate_state (source, fetch_run_id, catalog_epoch, collated_at)
        values ('spellbook', ${fetchRunId}, ${ctx.epoch}, now())
        on conflict (source) do update set fetch_run_id = excluded.fetch_run_id, catalog_epoch = excluded.catalog_epoch, collated_at = now()
      `;
      await db`commit`;
      const { combos = 0, unresolved = 0, unknown_tag: unknownTag = 0, unknown_status: unknownStatus = 0, banned = 0 } = counts ?? {};
      record(ctx, 'spellbook', { combos, kept, written, removed, unresolved, unknownTag, unknownStatus, banned });
      console.log(
        `corpus_collate: spellbook: ${combos} combos → ${kept} kept; ${written} written, ${removed} removed ` +
          `(left out: ${unresolved} naming a card the catalog lacks, ${banned} banned, ${unknownTag} unknown tags, ${unknownStatus} unknown results)`,
      );
      return { read: combos, changed: written + removed };
    } catch (err) {
      await db`rollback`.catch(() => {});
      throw err;
    }
  } finally {
    db.release();
  }
}

// === the run ===

/** The newest successful fetch run of a raw source, or 0 when it has none. */
async function latestFetch(sql: Sql, source: 'edhrec' | 'spellbook'): Promise<number> {
  const [row] = await sql<{ id: string | null }[]>`
    select max(id)::text as id from public.sync_runs where job = ${FETCH_JOB[source]} and status = 'succeeded'
  `;
  return Number(row?.id ?? 0);
}

async function rawIsEmpty(sql: Sql, source: CollateSource): Promise<boolean> {
  const [row] = await (source === 'edhrec'
    ? sql<{ empty: boolean }[]>`select not exists (select 1 from edhrec.commanders) as empty`
    : source === 'spellbook'
      ? sql<{ empty: boolean }[]>`select not exists (select 1 from spellbook.combos) as empty`
      : source === 'user'
        ? sql<{ empty: boolean }[]>`select not exists (select 1 from public.decks) as empty`
        : sql<{ empty: boolean }[]>`select not exists (select 1 from crawl.decks where source = ${source}) as empty`);
  return row?.empty ?? true;
}

/** Whether a deck source has rows written since its last collation (all of them, when it has none). */
async function decksChanged(sql: Sql, source: DeckSource, since: Date | null): Promise<boolean> {
  if (since === null) return true;
  const [row] = await (source === 'user'
    ? sql<{ changed: boolean }[]>`
        select exists (select 1 from public.decks where updated_at >= ${since}::timestamptz - ${RAW_OVERLAP}::interval) as changed`
    : sql<{ changed: boolean }[]>`
        select exists (
          select 1 from crawl.decks where source = ${source} and fetched_at >= ${since}::timestamptz - ${RAW_OVERLAP}::interval
        ) as changed`);
  return row?.changed ?? true;
}

/**
 * Collates every source with something new: raw rows written since its last collation, a newer fetch (EDHREC,
 * Spellbook), or a newer catalog (decks the corpus lacks are retried; Spellbook is cheap enough to redo). EDHREC waits
 * for its next fetch for names the catalog learns later. `force` collates every source and lets the share gate pass.
 */
export async function collate({ force = false, only }: { force?: boolean; only?: readonly CollateSource[] } = {}): Promise<
  'succeeded' | 'skipped' | 'failed_sanity'
> {
  const sql = connect();
  let runId: number | null = null;
  try {
    const [epochRow] = await sql<{ epoch: string }[]>`select public.catalog_epoch() as epoch`;
    const epoch = Number(epochRow?.epoch ?? 0);
    const stateRows = await sql<(CollateState & { source: CollateSource })[]>`
      select source, raw_since, fetch_run_id::text, catalog_epoch::text from corpus.collate_state
    `;
    const states = new Map(stateRows.map((s) => [s.source, s]));
    const catalogMoved = (source: CollateSource) => Number(states.get(source)?.catalog_epoch ?? -1) < epoch;

    const work: CollateSource[] = [];
    const fetchRuns: Partial<Record<'edhrec' | 'spellbook', number>> = {};
    for (const source of only ?? COLLATE_SOURCES) {
      if (await rawIsEmpty(sql, source)) {
        // Never collate from an empty raw source: it would only remove (the gate would refuse anyway).
        const held = await count(
          source === 'edhrec'
            ? sql<{ n: number }[]>`select count(*)::int as n from corpus.edhrec_commanders`
            : source === 'spellbook'
              ? sql<{ n: number }[]>`select count(*)::int as n from corpus.spellbook_combos`
              : sql<{ n: number }[]>`select count(*)::int as n from corpus.decks where source = ${source}`,
        );
        if (held > 0) console.log(`corpus_collate: ${source}: raw is empty; its ${held} corpus rows are left as they are.`);
        continue;
      }
      if (source === 'edhrec' || source === 'spellbook') {
        const fetchRunId = await latestFetch(sql, source);
        if (fetchRunId === 0) {
          // Raw rows without a finished fetch are a trial run's or a crash's: never collate a partial source.
          console.log(`corpus_collate: ${source}: no fetch has finished yet; waiting for one.`);
          continue;
        }
        const newFetch = fetchRunId > Number(states.get(source)?.fetch_run_id ?? 0);
        if (force || newFetch || (source === 'spellbook' && catalogMoved(source))) {
          fetchRuns[source] = fetchRunId;
          work.push(source);
        }
        continue;
      }
      if (force || catalogMoved(source) || (await decksChanged(sql, source, states.get(source)?.raw_since ?? null))) work.push(source);
    }
    if (work.length === 0) {
      console.log('corpus_collate: nothing new since the last collation. Use --force to re-run.');
      return 'skipped';
    }

    const start = await startRun(sql, 'corpus_collate', { uri: 'postgres:raw', updatedAt: new Date().toISOString() }, true);
    if (start.kind === 'skipped') return 'skipped';
    runId = start.runId;
    const [configRow] = await sql<{ share: number | null }[]>`
      select (value ->> 'collateMaxRemovedShare')::real as share from public.app_config where key = 'corpus'
    `;
    const ctx: Context = { sql, force, epoch, maxRemovedShare: configRow?.share ?? DEFAULT_MAX_REMOVED_SHARE, metrics: { catalogEpoch: epoch } };
    const catalog = await loadCatalog(sql);

    let rowsRead = 0;
    let rowsChanged = 0;
    const refused: string[] = [];
    for (const source of work) {
      try {
        const result =
          source === 'edhrec'
            ? await collateEdhrec(ctx, fetchRuns.edhrec ?? 0)
            : source === 'spellbook'
              ? await collateSpellbook(ctx, fetchRuns.spellbook ?? 0)
              : await collateDecks(ctx, runId, source, catalog, states.get(source));
        rowsRead += result.read;
        rowsChanged += result.changed;
      } catch (err) {
        if (!(err instanceof SanityError)) throw err;
        refused.push(err.message);
        console.error(`corpus_collate: sanity gate: ${err.message}. Its corpus rows are unchanged; re-run with --force if this is expected.`);
      }
    }

    if (refused.length > 0) {
      await finishRun(sql, runId, 'failed_sanity', { rowsRead, rowsChanged, metrics: ctx.metrics, error: `sanity gate: ${refused.join('; ')}` });
      process.exitCode = 1;
      return 'failed_sanity';
    }
    await finishRun(sql, runId, 'succeeded', { rowsRead, rowsChanged, metrics: ctx.metrics });
    return 'succeeded';
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
