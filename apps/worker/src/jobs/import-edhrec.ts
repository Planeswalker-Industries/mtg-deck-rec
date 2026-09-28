import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { edhrecCommanderPage, normalizeName } from '@mtg/core/parse';
import { DATA_DIR } from '../lib/config';
import { connect, type Sql } from '../lib/db';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/** Where X:\mtg_proj\tools\edhrec-crawl.mjs saves one JSON file per commander page. */
export const DEFAULT_EDHREC_DIR = path.join(DATA_DIR, 'edhrec', 'commanders');

const SOURCE = 'edhrec';
const BATCH_SIZE = 5000; // rows per staging insert; 5 columns stays well under Postgres's 65,535 parameters
const HEARTBEAT_EVERY = 500; // pages read between heartbeats
const HEARTBEAT_EVERY_BATCHES = 20; // staging inserts between heartbeats (100,000 rows)
/** A reload must keep at least this share of the previous run's commanders, so a half-copied folder can't wipe them. */
const MIN_COMMANDER_SHARE = 0.8;
/** More card rows than this failing to resolve means the catalog and the pages disagree about something big. */
const MAX_UNRESOLVED_CARD_RATE = 0.02;

interface CommanderRow {
  slug: string;
  commander_1: number;
  commander_2: number | null;
  deck_count: number;
  fetched_at: Date;
}

interface CardRow {
  slug: string;
  card_id: number;
  decks_with: number;
  potential_decks: number;
  synergy: number | null;
}

/** Scryfall printing id → card id, and normalized name → card ids, for the live catalog. */
async function loadResolvers(sql: Sql) {
  const printings = await sql<{ id: string; card_id: number }[]>`
    select p.id::text, p.card_id from public.printings p join public.cards c on c.id = p.card_id
    where p.deleted_at is null and c.deleted_at is null
  `;
  const names = await sql<{ name_normalized: string; card_id: number }[]>`
    select n.name_normalized, n.card_id from public.card_names n join public.cards c on c.id = n.card_id where c.deleted_at is null
  `;
  const byPrinting = new Map(printings.map((p) => [p.id, p.card_id]));
  const byName = new Map<string, Set<number>>();
  for (const n of names) {
    let ids = byName.get(n.name_normalized);
    if (!ids) byName.set(n.name_normalized, (ids = new Set()));
    ids.add(n.card_id);
  }
  return {
    byPrinting,
    /** The one card a name belongs to, or null when it matches none or several. */
    byName(name: string): number | null {
      const ids = byName.get(normalizeName(name));
      return ids?.size === 1 ? ([...ids][0] ?? null) : null;
    },
  };
}

type Resolvers = Awaited<ReturnType<typeof loadResolvers>>;

/**
 * The page's commander card ids, ascending: one for a single card (both faces of a double-faced card resolve to it), two
 * for a partner pair. Every name must match one card, since a pair with an unmatched partner would otherwise pass for
 * the other partner alone; the page's printing id only stands in for a page that names a single card. Null when that
 * fails or the page names more than two cards.
 */
function resolveCommanders(names: string[], printingId: string | null, resolvers: Resolvers): number[] | null {
  const ids = names.map((name) => resolvers.byName(name));
  if (ids.every((id) => id !== null)) {
    const distinct = [...new Set(ids)].sort((x, y) => x - y);
    return distinct.length <= 2 ? distinct : null;
  }
  const fromPrinting = names.length === 1 && printingId ? resolvers.byPrinting.get(printingId) : undefined;
  return fromPrinting === undefined ? null : [fromPrinting];
}

/**
 * EDHREC commander pages on disk → external_commanders, external_commander_card_stats. Reads the files the crawl saved
 * rather than fetching, so a reload makes no requests. Same failure model as the other syncs: stage, sanity-check,
 * merge only the rows that differ in one transaction.
 */
export async function importEdhrec({ dir = DEFAULT_EDHREC_DIR, force = false }: { dir?: string | undefined; force?: boolean } = {}): Promise<
  'succeeded' | 'skipped' | 'failed_sanity'
> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No .json pages in ${dir}. Run X:\\mtg_proj\\tools\\edhrec-crawl.mjs first.`);
  const mtimes = await Promise.all(files.map(async (f) => (await stat(path.join(dir, f))).mtime));
  const newest = new Date(Math.max(...mtimes.map((m) => m.getTime())));

  const sql = connect();
  let runId: number | null = null;
  let pagesRead = 0;

  try {
    const start = await startRun(sql, 'edhrec_stats', { uri: `file://${dir}`, updatedAt: newest.toISOString() }, force);
    if (start.kind === 'skipped') {
      console.log(`edhrec_stats: no page in ${dir} changed since the last successful run. Use --force to re-run.`);
      return 'skipped';
    }
    runId = start.runId;
    const resolvers = await loadResolvers(sql);

    const commanders = new Map<string, CommanderRow>(); // commander pair key → the page with the most decks
    const cardsBySlug = new Map<string, CardRow[]>();
    const counts = { notCommanderPage: 0, noDecks: 0, unresolvedCommander: 0, duplicatePair: 0, cardViews: 0, unresolvedCards: 0 };
    const unresolvedExamples: string[] = [];

    for (const [i, file] of files.entries()) {
      pagesRead++;
      if (pagesRead % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, pagesRead);
      const slug = file.slice(0, -'.json'.length);
      const page = edhrecCommanderPage(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
      if (!page) {
        counts.notCommanderPage++;
        continue;
      }
      if (page.deckCount === 0) {
        counts.noDecks++;
        continue;
      }
      const ids = resolveCommanders(page.names, page.printingId, resolvers);
      if (!ids) {
        counts.unresolvedCommander++;
        if (unresolvedExamples.length < 10) unresolvedExamples.push(`${slug} (${page.names.join(' + ')})`);
        continue;
      }

      const pairKey = ids.join(':');
      const existing = commanders.get(pairKey);
      if (existing) {
        counts.duplicatePair++;
        if (existing.deck_count >= page.deckCount) continue;
        cardsBySlug.delete(existing.slug);
      }
      commanders.set(pairKey, {
        slug,
        commander_1: ids[0] as number,
        commander_2: ids[1] ?? null,
        deck_count: page.deckCount,
        fetched_at: mtimes[i] as Date,
      });

      const byCard = new Map<number, CardRow>();
      for (const card of page.cards) {
        counts.cardViews++;
        const cardId = resolvers.byPrinting.get(card.printingId) ?? resolvers.byName(card.name);
        if (cardId === undefined || cardId === null) {
          counts.unresolvedCards++;
          continue;
        }
        const seen = byCard.get(cardId);
        if (!seen || seen.decks_with < card.decksWith) {
          byCard.set(cardId, { slug, card_id: cardId, decks_with: card.decksWith, potential_decks: card.potentialDecks, synergy: card.synergy });
        }
      }
      cardsBySlug.set(slug, [...byCard.values()]);
    }

    const commanderRows = [...commanders.values()];
    const cardRows = [...cardsBySlug.values()].flat();
    const unresolvedRate = counts.cardViews > 0 ? counts.unresolvedCards / counts.cardViews : 1;
    const previousCommanders = start.previousMetrics?.commanders;
    const metrics: SyncMetrics = { pages: files.length, commanders: commanderRows.length, cardRows: cardRows.length, ...counts };

    if (
      !force &&
      (commanderRows.length === 0 ||
        unresolvedRate > MAX_UNRESOLVED_CARD_RATE ||
        (previousCommanders && commanderRows.length < previousCommanders * MIN_COMMANDER_SHARE))
    ) {
      const error = `sanity gate: ${commanderRows.length} commanders (previous ${previousCommanders ?? 'none'}), unresolved cards ${(unresolvedRate * 100).toFixed(2)}%`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: pagesRead, metrics, error });
      console.error(`edhrec_stats: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
      process.exitCode = 1;
      return 'failed_sanity';
    }

    let written = { commanders: 0, cardRows: 0, cardRowsRemoved: 0 };
    const db = await sql.reserve();
    try {
      await db`
        create temp table stg_commanders (
          slug text primary key,
          commander_1 integer not null,
          commander_2 integer,
          deck_count integer not null,
          fetched_at timestamptz not null
        )
      `;
      await db`
        create temp table stg_card_stats (
          slug text not null,
          card_id integer not null,
          decks_with integer not null,
          potential_decks integer not null,
          synergy real
        )
      `;
      for (let i = 0; i < commanderRows.length; i += BATCH_SIZE) {
        await db`insert into stg_commanders ${db(commanderRows.slice(i, i + BATCH_SIZE), 'slug', 'commander_1', 'commander_2', 'deck_count', 'fetched_at')}`;
      }
      for (let i = 0; i < cardRows.length; i += BATCH_SIZE) {
        await db`insert into stg_card_stats ${db(cardRows.slice(i, i + BATCH_SIZE), 'slug', 'card_id', 'decks_with', 'potential_decks', 'synergy')}`;
        if ((i / BATCH_SIZE) % HEARTBEAT_EVERY_BATCHES === 0) await heartbeat(sql, runId, pagesRead);
      }

      await db`begin`;
      try {
        // Gone pages first, so a pair that moved to another slug can take its place under the pair's unique index.
        await db`
          delete from public.external_commanders e
          where e.source = ${SOURCE} and not exists (select 1 from stg_commanders s where s.slug = e.slug)
        `;
        await db`
          delete from public.external_commanders e
          using stg_commanders s
          where e.source = ${SOURCE} and e.slug = s.slug
            and (e.commander_1, coalesce(e.commander_2, 0)) is distinct from (s.commander_1, coalesce(s.commander_2, 0))
        `;
        const [commandersWritten] = await db<{ n: number }[]>`
          with written as (
            insert into public.external_commanders as e (source, slug, commander_1, commander_2, deck_count, fetched_at)
            select ${SOURCE}, slug, commander_1, commander_2, deck_count, fetched_at from stg_commanders
            on conflict (source, slug) do update set deck_count = excluded.deck_count, fetched_at = excluded.fetched_at
            where (e.deck_count, e.fetched_at) is distinct from (excluded.deck_count, excluded.fetched_at)
            returning 1
          )
          select count(*)::int as n from written
        `;
        await db`
          create temp table stg_card_rows as
          select e.id as external_commander_id, s.card_id, s.decks_with, s.potential_decks, s.synergy
          from stg_card_stats s
          join public.external_commanders e on e.source = ${SOURCE} and e.slug = s.slug
        `;
        await db`alter table stg_card_rows add primary key (external_commander_id, card_id)`;
        const [removed] = await db<{ n: number }[]>`
          with removed as (
            delete from public.external_commander_card_stats cs
            using public.external_commanders e
            where e.id = cs.external_commander_id and e.source = ${SOURCE}
              and not exists (
                select 1 from stg_card_rows s where s.external_commander_id = cs.external_commander_id and s.card_id = cs.card_id
              )
            returning 1
          )
          select count(*)::int as n from removed
        `;
        const [cardsWritten] = await db<{ n: number }[]>`
          with written as (
            insert into public.external_commander_card_stats as cs (external_commander_id, card_id, decks_with, potential_decks, synergy)
            select external_commander_id, card_id, decks_with, potential_decks, synergy from stg_card_rows
            on conflict (external_commander_id, card_id) do update set
              decks_with = excluded.decks_with,
              potential_decks = excluded.potential_decks,
              synergy = excluded.synergy
            where (cs.decks_with, cs.potential_decks, cs.synergy) is distinct from (excluded.decks_with, excluded.potential_decks, excluded.synergy)
            returning 1
          )
          select count(*)::int as n from written
        `;
        await db`commit`;
        written = { commanders: commandersWritten?.n ?? 0, cardRows: cardsWritten?.n ?? 0, cardRowsRemoved: removed?.n ?? 0 };
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
    }

    await finishRun(sql, runId, 'succeeded', { rowsRead: pagesRead, rowsChanged: written.cardRows + written.cardRowsRemoved, metrics });
    console.log(
      `edhrec_stats: ${files.length} pages → ${commanderRows.length} commanders, ${cardRows.length} card rows ` +
        `(${written.commanders} commanders and ${written.cardRows} card rows written, ${written.cardRowsRemoved} removed)`,
    );
    console.log(
      `  skipped: ${counts.notCommanderPage} not commander pages, ${counts.noDecks} with no decks, ${counts.unresolvedCommander} unresolved ` +
        `commanders, ${counts.duplicatePair} duplicate pairs; ${counts.unresolvedCards} of ${counts.cardViews} card views unresolved`,
    );
    if (unresolvedExamples.length > 0) console.log(`  unresolved commanders, e.g.: ${unresolvedExamples.join('; ')}`);
    return 'succeeded';
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: pagesRead, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
