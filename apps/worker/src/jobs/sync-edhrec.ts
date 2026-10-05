import { edhrecCommanderPage, type EdhrecCardStat } from '@mtg/core/parse';
import { connect, type Sql } from '../lib/db';
import { politeFetch, RateLimiter } from '../lib/http';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/** EDHREC's list of every commander page (its robots.txt names it). */
const SITEMAP_URL = 'https://edhrec.com/sitemaps/commanders.xml';
/** A commander page as JSON: a static S3 bucket behind CloudFront. */
const pageUrl = (slug: string) => `https://json.edhrec.com/pages/commanders/${slug}.json`;
/** One commander page in the sitemap; colour group pages (`/commanders/abzan`) match too and parse as null. */
const COMMANDER_LOC = /<loc>https:\/\/edhrec\.com\/commanders\/([a-z0-9-]+)<\/loc>/g;

const FORBIDDEN = 403;
/** A key missing from the bucket is S3's own 403; a 403 from anything else is a block. */
const S3_SERVER = 'AmazonS3';
/** This many missing pages in a row means the page addresses changed, not that a few commanders were dropped. */
const MAX_MISSING_IN_A_ROW = 20;
const HEARTBEAT_EVERY = 100; // pages between heartbeats: 150 s at the default pace, well inside the 15-minute stale window
/** The pace when app_config.edhrec doesn't set one: one request every one and a half seconds. */
const DEFAULT_REQUEST_INTERVAL_MS = 1500;
/**
 * Pages the sitemap no longer lists are removed only when it lists at least this share of the pages held, so a
 * truncated sitemap can't empty the table.
 */
const MIN_SITEMAP_SHARE = 0.8;
/** A Scryfall printing id; anything else is stored as unknown rather than refused. */
const PRINTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface EdhrecSettings {
  requestIntervalMs?: number;
  /** Set when a block switched EDHREC off; only a person clears it. */
  disabledReason?: string;
}

async function loadSettings(sql: Sql): Promise<EdhrecSettings> {
  const [row] = await sql<{ value: EdhrecSettings }[]>`select value from public.app_config where key = 'edhrec'`;
  return row?.value ?? {};
}

class BlockedError extends Error {}

/** A block switches EDHREC off and says so in the audit log, like a crawl source; a person turns it back on. */
async function disable(sql: Sql, reason: string): Promise<never> {
  await sql`
    insert into public.app_config (key, value) values ('edhrec', jsonb_build_object('disabledReason', ${reason}::text))
    on conflict (key) do update set value = public.app_config.value || excluded.value, updated_at = now()
  `;
  await sql`insert into public.audit_log (action, payload) values ('edhrec.disabled', ${sql.json({ reason })})`;
  throw new BlockedError(`${reason}: switched EDHREC off (app_config.edhrec.disabledReason). Tell the owner rather than work around it.`);
}

/** The commander page slugs the sitemap lists, in its order, each once. */
export function sitemapSlugs(xml: string): string[] {
  return [...new Set([...xml.matchAll(COMMANDER_LOC)].map((m) => m[1] as string))];
}

/** A page's card rows, one per name, the highest count kept when a name repeats. */
function cardRows(slug: string, cards: EdhrecCardStat[]) {
  const byName = new Map<string, { slug: string; name: string; printing_id: string | null; decks_with: number; potential_decks: number; synergy: number | null }>();
  for (const card of cards) {
    const seen = byName.get(card.name);
    if (seen && seen.decks_with >= card.decksWith) continue;
    byName.set(card.name, {
      slug,
      name: card.name,
      printing_id: PRINTING_ID.test(card.printingId) ? card.printingId : null,
      decks_with: card.decksWith,
      potential_decks: card.potentialDecks,
      synergy: card.synergy,
    });
  }
  return [...byName.values()];
}

/**
 * EDHREC's commander pages → edhrec.commanders, edhrec.commander_cards, as published: the names and printing ids the
 * pages use, their deck counts and per-card counts. Resolving them to our cards is the collator's job (T054).
 *
 * Lists every commander page from the sitemap and fetches each as JSON, one at a time at the configured pace (about
 * three and a half hours for the whole list). Each page is written as it arrives, only where it changed, so a run that
 * stops halfway keeps what it fetched. Pages the sitemap no longer lists are removed once a run completes. The run is
 * recorded under the `edhrec_pages` job; the collator reads raw only after a successful one.
 *
 * A page that is gone is S3's own 403 and is counted. Any other 403, or a page that is not JSON, is a block: the run
 * stops, EDHREC is switched off and the audit log says why. `--limit` fetches only the first pages, for a trial run.
 */
export async function syncEdhrec({ limit }: { limit?: number } = {}): Promise<'succeeded' | 'skipped'> {
  const sql = connect();
  let runId: number | null = null;
  let pagesRead = 0;

  try {
    const settings = await loadSettings(sql);
    if (settings.disabledReason) {
      console.log(`edhrec_pages: EDHREC is switched off (${settings.disabledReason}). Clear app_config.edhrec.disabledReason to turn it back on.`);
      return 'skipped';
    }
    const limiter = new RateLimiter(settings.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS);

    // EDHREC refreshes its numbers continuously, so a run is never skipped as unchanged.
    const start = await startRun(sql, 'edhrec_pages', { uri: SITEMAP_URL, updatedAt: new Date().toISOString() }, true);
    if (start.kind === 'skipped') return 'skipped';
    runId = start.runId;

    const sitemap = await politeFetch(SITEMAP_URL, { limiter, accept: 'application/xml,text/xml;q=0.9' });
    const listed = sitemapSlugs(await sitemap.text());
    if (listed.length === 0) throw new Error(`${SITEMAP_URL} listed no commander pages`);
    const slugs = limit === undefined ? listed : listed.slice(0, limit);

    const counts = { listed: listed.length, fetched: 0, missing: 0, notCommanderPage: 0, pagesWritten: 0, cardRowsWritten: 0, cardRowsRemoved: 0 };
    let missingInARow = 0;

    for (const slug of slugs) {
      pagesRead++;
      if (pagesRead % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, pagesRead);
      const res = await politeFetch(pageUrl(slug), { limiter, accept: 'application/json', passStatuses: new Set([FORBIDDEN]) });
      if (res.status === FORBIDDEN) {
        const server = res.headers.get('server');
        await res.body?.cancel();
        if (server !== S3_SERVER) await disable(sql, `EDHREC answered ${FORBIDDEN} from ${server ?? 'an unknown server'} for ${slug}`);
        counts.missing++;
        if (++missingInARow >= MAX_MISSING_IN_A_ROW) throw new Error(`${MAX_MISSING_IN_A_ROW} commander pages in a row were missing: EDHREC's page addresses changed.`);
        continue;
      }
      missingInARow = 0;
      if (!(res.headers.get('content-type') ?? '').includes('json')) {
        await res.body?.cancel();
        await disable(sql, `EDHREC answered ${res.headers.get('content-type') ?? 'no content type'} instead of JSON for ${slug}`);
      }
      const page = edhrecCommanderPage(await res.json());
      if (!page) {
        counts.notCommanderPage++;
        continue;
      }
      counts.fetched++;

      const rows = cardRows(slug, page.cards);
      const printingId = page.printingId && PRINTING_ID.test(page.printingId) ? page.printingId : null;
      await sql.begin(async (tx) => {
        const [old] = await tx<{ names: string[]; printing_id: string | null; deck_count: number }[]>`
          select names, printing_id::text, deck_count from edhrec.commanders where slug = ${slug}
        `;
        // fetched_at always moves: it says when the page was last read, which is what the collator orders by.
        await tx`
          insert into edhrec.commanders (slug, names, printing_id, deck_count, fetched_at)
          values (${slug}, ${page.names}, ${printingId}, ${page.deckCount}, now())
          on conflict (slug) do update set
            names = excluded.names, printing_id = excluded.printing_id, deck_count = excluded.deck_count, fetched_at = excluded.fetched_at
        `;
        const sameNames = old?.names.length === page.names.length && old.names.every((name, i) => name === page.names[i]);
        const headerChanged = !old || !sameNames || old.deck_count !== page.deckCount || old.printing_id !== printingId;
        const [removed] = await tx<{ n: number }[]>`
          with removed as (
            delete from edhrec.commander_cards cc
            where cc.slug = ${slug} and not (cc.name = any (${rows.map((r) => r.name)}::text[]))
            returning 1
          )
          select count(*)::int as n from removed
        `;
        const [written] =
          rows.length === 0
            ? [{ n: 0 }]
            : await tx<{ n: number }[]>`
                with written as (
                  -- No alias on the target: postgres.js recognises its insert helper only straight after the table name.
                  insert into edhrec.commander_cards ${tx(rows, 'slug', 'name', 'printing_id', 'decks_with', 'potential_decks', 'synergy')}
                  on conflict (slug, name) do update set
                    printing_id = excluded.printing_id, decks_with = excluded.decks_with,
                    potential_decks = excluded.potential_decks, synergy = excluded.synergy
                  where (commander_cards.printing_id, commander_cards.decks_with, commander_cards.potential_decks, commander_cards.synergy)
                    is distinct from (excluded.printing_id, excluded.decks_with, excluded.potential_decks, excluded.synergy)
                  returning 1
                )
                select count(*)::int as n from written
              `;
        counts.cardRowsRemoved += removed?.n ?? 0;
        counts.cardRowsWritten += written?.n ?? 0;
        if (headerChanged || (removed?.n ?? 0) > 0 || (written?.n ?? 0) > 0) counts.pagesWritten++;
      });
    }

    // Pages EDHREC no longer lists, once the whole list was read and it looks whole.
    let pagesRemoved = 0;
    if (limit === undefined) {
      const [held] = await sql<{ n: number }[]>`select count(*)::int as n from edhrec.commanders`;
      if (listed.length >= (held?.n ?? 0) * MIN_SITEMAP_SHARE) {
        const [removed] = await sql<{ n: number }[]>`
          with removed as (delete from edhrec.commanders where not (slug = any (${listed}::text[])) returning 1)
          select count(*)::int as n from removed
        `;
        pagesRemoved = removed?.n ?? 0;
      } else {
        console.warn(`edhrec_pages: the sitemap listed ${listed.length} pages against ${held?.n ?? 0} held; nothing removed.`);
      }
    }

    const metrics: SyncMetrics = { ...counts, pagesRemoved, limited: limit === undefined ? 0 : 1 };
    const rowsChanged = counts.pagesWritten + counts.cardRowsWritten + counts.cardRowsRemoved + pagesRemoved;
    // A trial run (--limit) is recorded as failed, so the collator never reads a partial EDHREC as a finished fetch.
    if (limit !== undefined) {
      await finishRun(sql, runId, 'failed', { rowsRead: pagesRead, rowsChanged, metrics, error: `trial run: first ${limit} pages only` });
    } else {
      await finishRun(sql, runId, 'succeeded', { rowsRead: pagesRead, rowsChanged, metrics });
    }
    console.log(
      `edhrec_pages: ${slugs.length} of ${listed.length} listed pages → ${counts.fetched} commander pages ` +
        `(${counts.pagesWritten} changed, ${counts.cardRowsWritten} card rows written, ${counts.cardRowsRemoved} removed, ${pagesRemoved} pages removed; ` +
        `${counts.missing} missing, ${counts.notCommanderPage} not commander pages)`,
    );
    return 'succeeded';
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: pagesRead, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
    if (err instanceof BlockedError) process.exitCode = 1;
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
