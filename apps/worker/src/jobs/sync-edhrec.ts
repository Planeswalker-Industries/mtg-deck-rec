import { edhrecCommanderPage, normalizeName } from '@mtg/core/parse';
import { connect, type Sql } from '../lib/db';
import { politeFetch, RateLimiter } from '../lib/http';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/** EDHREC's list of every commander page (robots.txt names it). */
const SITEMAP_URL = 'https://edhrec.com/sitemaps/commanders.xml';
/** A commander page as JSON: a static S3 bucket behind CloudFront. */
const pageUrl = (slug: string) => `https://json.edhrec.com/pages/commanders/${slug}.json`;
/** One commander page in the sitemap; colour pages (`/commanders/abzan`) match too and parse as null. */
const COMMANDER_LOC = /<loc>https:\/\/edhrec\.com\/commanders\/([a-z0-9-]+)<\/loc>/g;

const SOURCE = 'edhrec';
const BATCH_SIZE = 5000; // rows per staging insert; 5 columns stays well under Postgres's 65,535 parameters
const HEARTBEAT_EVERY = 100; // pages between heartbeats: 150 s at the default pace, well inside the 15-minute stale window
/** The pace when app_config.worker does not say: EDHREC's pages are static, but one request a second-and-a-half is polite. */
const DEFAULT_REQUEST_INTERVAL_MS = 1500;
const FORBIDDEN = 403;
/** A missing key on the bucket is S3's own 403; any other 403 is a block. */
const S3_SERVER = 'AmazonS3';
/** This many missing pages in a row means the page addresses changed, not that a few commanders were dropped. */
const MAX_MISSING_IN_A_ROW = 20;
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

interface WorkerSettings {
  edhrecRequestIntervalMs?: number;
  /** Set when a block switched EDHREC off; only a person clears it. */
  edhrecDisabledReason?: string;
}

async function loadSettings(sql: Sql): Promise<WorkerSettings> {
  const [row] = await sql<{ value: WorkerSettings }[]>`select value from public.app_config where key = 'worker'`;
  return row?.value ?? {};
}

/** A block switches EDHREC off and says so in the audit log, the same as a crawl source; a person turns it back on. */
async function disableSource(sql: Sql, reason: string): Promise<void> {
  await sql`
    update public.app_config set value = value || jsonb_build_object('edhrecDisabledReason', ${reason}::text), updated_at = now()
    where key = 'worker'
  `;
  await sql`insert into public.audit_log (action, payload) values ('edhrec.disabled', ${sql.json({ reason })})`;
}

/** The commander page slugs the sitemap lists, in its order, each once. */
export function sitemapSlugs(xml: string): string[] {
  return [...new Set([...xml.matchAll(COMMANDER_LOC)].map((m) => m[1] as string))];
}

/**
 * EDHREC's commander pages → external_commanders, external_commander_card_stats. Lists every commander page from the
 * sitemap, fetches each as JSON one at a time at the configured pace (about three and a half hours for the whole
 * list), then merges them the way the other syncs do: stage, sanity-check, write only the rows that differ in one
 * transaction. Runs on the VPS worker's schedule.
 *
 * A page that is gone is S3's own 403 and is counted, not raised. Any other 403, or a page that is not JSON, is a block:
 * the run stops, EDHREC is switched off (`app_config.worker.edhrecDisabledReason`) and the audit log says why.
 */
export async function syncEdhrec({ force = false, limit }: { force?: boolean; limit?: number | undefined } = {}): Promise<
  'succeeded' | 'skipped' | 'failed_sanity'
> {
  const sql = connect();
  let runId: number | null = null;
  let pagesRead = 0;

  try {
    const settings = await loadSettings(sql);
    if (settings.edhrecDisabledReason && !force) {
      console.log(`edhrec_stats: EDHREC is switched off (${settings.edhrecDisabledReason}). Clear app_config.worker.edhrecDisabledReason to turn it back on.`);
      return 'skipped';
    }
    const limiter = new RateLimiter(settings.edhrecRequestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS);

    const start = await startRun(sql, 'edhrec_stats', { uri: SITEMAP_URL, updatedAt: new Date().toISOString() }, force);
    if (start.kind === 'skipped') return 'skipped';
    runId = start.runId;
    const resolvers = await loadResolvers(sql);

    const sitemap = await politeFetch(SITEMAP_URL, { limiter, accept: 'application/xml,text/xml;q=0.9' });
    const slugs = sitemapSlugs(await sitemap.text()).slice(0, limit);
    if (slugs.length === 0) throw new Error(`${SITEMAP_URL} listed no commander pages`);
    let missingInARow = 0;

    const commanders = new Map<string, CommanderRow>(); // commander pair key → the page with the most decks
    const cardsBySlug = new Map<string, CardRow[]>();
    const counts = { missing: 0, notCommanderPage: 0, noDecks: 0, unresolvedCommander: 0, duplicatePair: 0, cardViews: 0, unresolvedCards: 0 };
    const unresolvedExamples: string[] = [];

    for (const slug of slugs) {
      pagesRead++;
      if (pagesRead % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, pagesRead);
      const res = await politeFetch(pageUrl(slug), { limiter, accept: 'application/json', passStatuses: new Set([FORBIDDEN]) });
      if (res.status === FORBIDDEN) {
        const server = res.headers.get('server');
        await res.body?.cancel();
        if (server !== S3_SERVER) {
          const reason = `EDHREC answered ${FORBIDDEN} from ${server ?? 'an unknown server'} for ${slug}`;
          await disableSource(sql, reason);
          throw new Error(`${reason}: switched EDHREC off; tell the owner rather than working around it.`);
        }
        counts.missing++;
        if (++missingInARow >= MAX_MISSING_IN_A_ROW) throw new Error(`${MAX_MISSING_IN_A_ROW} commander pages in a row were missing: EDHREC's page addresses changed.`);
        continue;
      }
      missingInARow = 0;
      if (!(res.headers.get('content-type') ?? '').includes('json')) {
        const reason = `EDHREC answered ${res.headers.get('content-type') ?? 'no content type'} instead of JSON for ${slug}`;
        await res.body?.cancel();
        await disableSource(sql, reason);
        throw new Error(`${reason}: switched EDHREC off; tell the owner rather than working around it.`);
      }
      const page = edhrecCommanderPage(await res.json());
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
        fetched_at: new Date(),
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
    const metrics: SyncMetrics = { pages: slugs.length, commanders: commanderRows.length, cardRows: cardRows.length, ...counts };

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
      `edhrec_stats: ${slugs.length} pages → ${commanderRows.length} commanders, ${cardRows.length} card rows ` +
        `(${written.commanders} commanders and ${written.cardRows} card rows written, ${written.cardRowsRemoved} removed)`,
    );
    console.log(
      `  skipped: ${counts.missing} missing, ${counts.notCommanderPage} not commander pages, ${counts.noDecks} with no decks, ${counts.unresolvedCommander} unresolved ` +
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
