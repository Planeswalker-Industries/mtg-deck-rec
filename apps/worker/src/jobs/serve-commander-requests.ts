import { setTimeout as sleep } from 'node:timers/promises';
import { loadCorpusConfig } from '../lib/corpus';
import type { Sql } from '../lib/db';
import { HttpError } from '../lib/http';
import { WORKER_ID } from '../lib/sync-runs';
import { COMMANDER_FORMAT, getDeck, listDecks, RateLimitedError, ShapeError, type Deck } from '../sources/archidekt/client';
import { qualifyDeck } from '../sources/archidekt/deck';
import { aggregateCorpus } from './aggregate-corpus';
import { deckRow } from './import-decks';

export const WORKER_NAME = 'commander-requests';
/** A lookup whose worker hasn't checked in for this long goes back in line. */
const STALE_AFTER = '10 minutes';
const SOURCE = 'archidekt';
const DECK_SIZE = 100;
const MAX_PAGES = 40;
/** How long a claim may sit before the crawl takes it over as stale, when app_config.archidekt does not say. */
const DEFAULT_STALE_CLAIM_SECONDS = 21_600;
/** How often, and how many times, to wait for a corpus rebuild someone else is running before giving up. */
const AGGREGATE_RETRY_MS = 30_000;
const AGGREGATE_ATTEMPTS = 20;

interface ClaimedRequest {
  id: string;
  commander_card_id: number;
  decks_target: number;
}

interface RunCounts {
  pages_seen: number;
  decks_listed: number;
  decks_fetched: number;
  decks_written: number;
  skipped_unchanged: number;
  skipped_unqualified: number;
  skipped_missing: number;
  skipped_unresolved: number;
  commanders_visited: number;
}

type FinalStatus = 'done' | 'not_enough_decks' | 'failed';

export async function checkIn(sql: Sql): Promise<void> {
  await sql`
    insert into public.worker_status (name, heartbeat_at) values (${WORKER_NAME}, now())
    on conflict (name) do update set heartbeat_at = now()
  `;
}

async function progress(
  sql: Sql,
  id: number,
  fields: { status?: 'collecting' | 'aggregating'; decksListed?: number; decksCollected?: number },
): Promise<void> {
  await sql`
    update public.commander_requests
    set status = coalesce(${fields.status ?? null}::public.commander_request_status, status),
        decks_listed = coalesce(${fields.decksListed ?? null}::integer, decks_listed),
        decks_collected = coalesce(${fields.decksCollected ?? null}::integer, decks_collected),
        heartbeat_at = now(),
        updated_at = now()
    where id = ${id}
  `;
  await checkIn(sql);
}

async function finish(sql: Sql, id: number, status: FinalStatus, error: string | null, decksCollected?: number): Promise<void> {
  await sql`
    update public.commander_requests
    set status = ${status}::public.commander_request_status,
        error = ${error},
        decks_collected = coalesce(${decksCollected ?? null}::integer, decks_collected),
        finished_at = now(),
        heartbeat_at = now(),
        updated_at = now()
    where id = ${id}
  `;
  console.log(`commander request ${id}: ${status}${error ? ` (${error})` : ''}`);
}

async function fetchDeck(id: number, counts: RunCounts): Promise<Deck | null> {
  try {
    const deck = await getDeck(id);
    counts.decks_fetched++;
    return deck;
  } catch (err) {
    // Deleted or made private since it was listed, or a response we can't read: skip it.
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) {
      counts.skipped_missing++;
      return null;
    }
    if (err instanceof ShapeError) {
      console.warn(`deck ${id}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

/** Whether the daily crawl (or anything else) holds Archidekt's claim right now. */
async function sourceBusy(sql: Sql, staleSeconds: number): Promise<boolean> {
  const [state] = await sql<{ busy: boolean }[]>`
    select running_run_id is not null and claimed_at > now() - make_interval(secs => ${staleSeconds}) as busy
    from corpus.crawl_state where source = ${SOURCE}
  `;
  return state?.busy ?? false;
}

async function staleClaimSeconds(sql: Sql): Promise<number> {
  const [row] = await sql<{ seconds: number | null }[]>`
    select (value->>'staleClaimSeconds')::int as seconds from public.app_config where key = ${SOURCE}
  `;
  return row?.seconds ?? DEFAULT_STALE_CLAIM_SECONDS;
}

/** Rebuilds the corpus stats, waiting out a rebuild the scheduler already started. */
async function rebuildStats(): Promise<'succeeded' | 'skipped' | 'failed_sanity'> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await aggregateCorpus({ force: true });
    } catch (err) {
      const busy = err instanceof Error && err.message.includes('already in progress');
      if (!busy || attempt >= AGGREGATE_ATTEMPTS) throw err;
      await sleep(AGGREGATE_RETRY_MS);
    }
  }
}

async function collect(sql: Sql, id: number, request: ClaimedRequest, counts: RunCounts): Promise<FinalStatus | 'collected'> {
  const [commander] = await sql<{ name: string; oracle_id: string }[]>`
    select name, oracle_id::text from public.cards where id = ${request.commander_card_id} and deleted_at is null
  `;
  if (!commander) {
    await finish(sql, id, 'failed', 'That commander is no longer in the card catalog.');
    return 'failed';
  }
  const config = await loadCorpusConfig(sql);
  const target = request.decks_target;
  console.log(`commander request ${id}: ${commander.name}, up to ${target} decks`);
  counts.commanders_visited = 1;

  const listPage = (page: number) => listDecks({ page, commanderName: commander.name, size: DECK_SIZE, orderBy: '-viewCount' });
  let listing = await listPage(1);
  counts.pages_seen++;
  await progress(sql, id, { status: 'collecting', decksListed: listing.count, decksCollected: 0 });
  if (listing.count < config.minDecks) {
    await finish(sql, id, 'not_enough_decks', null);
    return 'not_enough_decks';
  }

  const [led] = await sql<{ n: number }[]>`
    select count(*)::int as n from corpus.decks
    where source = ${SOURCE} and commander_card_ids @> array[${request.commander_card_id}::int]
  `;
  let collected = led?.n ?? 0;
  await progress(sql, id, { decksCollected: Math.min(collected, target) });

  for (let page = 1; collected < target && page <= MAX_PAGES; page++) {
    if (page > 1) {
      listing = await listPage(page);
      counts.pages_seen++;
    }
    const listed = listing.results.filter((summary) => summary.deckFormat === COMMANDER_FORMAT);
    counts.decks_listed += listing.results.length;
    const held = new Set(
      (
        await sql<{ source_deck_id: string }[]>`
          select source_deck_id from corpus.decks where source = ${SOURCE} and source_deck_id = any (${listed.map((d) => String(d.id))}::text[])
        `
      ).map((r) => r.source_deck_id),
    );
    for (const summary of listed) {
      if (collected >= target) break;
      if (held.has(String(summary.id))) {
        counts.skipped_unchanged++;
        continue;
      }
      const deck = await fetchDeck(summary.id, counts);
      if (!deck) continue;
      const outcome = qualifyDeck(deck, commander.oracle_id);
      if (!outcome.ok) {
        counts.skipped_unqualified++;
        continue;
      }
      const [result] = await sql<{ result: { written: number; unresolved: unknown[] } }[]>`
        select public.crawl_upsert_decks(${SOURCE}, ${sql.json([deckRow(outcome.deck)])}) as result
      `;
      if ((result?.result.unresolved.length ?? 0) > 0) {
        counts.skipped_unresolved++;
        continue;
      }
      counts.decks_written += result?.result.written ?? 0;
      collected++;
      await progress(sql, id, { decksCollected: collected });
    }
    if (!listing.hasNext) break;
  }

  if (collected < config.minDecks) {
    await finish(sql, id, 'not_enough_decks', null, collected);
    return 'not_enough_decks';
  }
  return 'collected';
}

/**
 * Serves the oldest queued deck lookup, if any: lists the commander's Archidekt decks most viewed first, stores the
 * qualifying ones in corpus.decks (resolved and diffed by crawl_upsert_decks, like the crawl's), then rebuilds the corpus
 * stats. Takes Archidekt's crawl claim for the collecting, so it never presses the site while the daily crawl does;
 * while the crawl holds the claim the request waits, and the crawl's queue puts the requested commander first.
 */
export async function serveNextRequest(sql: Sql): Promise<'served' | 'idle' | 'busy'> {
  // A lookup whose worker died goes back in line; decks it already stored still count toward its target.
  await sql`
    update public.commander_requests
    set status = 'queued', updated_at = now()
    where status in ('checking', 'collecting', 'aggregating') and heartbeat_at < now() - ${STALE_AFTER}::interval
  `;
  const staleSeconds = await staleClaimSeconds(sql);
  if (await sourceBusy(sql, staleSeconds)) return 'busy';

  const [claimed] = await sql<ClaimedRequest[]>`
    update public.commander_requests
    set status = 'checking', started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
    where id = (
      select id from public.commander_requests where status = 'queued' order by created_at limit 1 for update skip locked
    )
    returning id::text, commander_card_id, decks_target
  `;
  if (!claimed) return 'idle';
  const id = Number(claimed.id);

  const [run] = await sql<{ id: string }[]>`select public.crawl_create_run(${SOURCE}) as id`;
  const runId = Number(run?.id);
  await sql`update corpus.crawl_runs set kind = 'request' where id = ${runId}`;
  const [claim] = await sql<{ claim: { claimed: boolean } }[]>`
    select public.crawl_claim(${SOURCE}, ${runId}, ${WORKER_ID}, ${staleSeconds}) as claim
  `;
  if (!claim?.claim.claimed) {
    await sql`select public.crawl_finish_run(${runId}, ${sql.json({ state: 'failed', error: 'already running' })})`;
    await sql`update public.commander_requests set status = 'queued', updated_at = now() where id = ${id}`;
    return 'busy';
  }

  const counts: RunCounts = {
    pages_seen: 0,
    decks_listed: 0,
    decks_fetched: 0,
    decks_written: 0,
    skipped_unchanged: 0,
    skipped_unqualified: 0,
    skipped_missing: 0,
    skipped_unresolved: 0,
    commanders_visited: 0,
  };
  let state: 'succeeded' | 'failed' = 'succeeded';
  let error = '';
  let outcome: FinalStatus | 'collected' = 'failed';
  try {
    outcome = await collect(sql, id, claimed, counts);
  } catch (err) {
    state = 'failed';
    error = err instanceof RateLimitedError ? 'Archidekt is busy right now.' : err instanceof Error ? err.message : String(err);
    console.error(`commander request ${id} failed:`, err);
    await finish(sql, id, 'failed', error);
  } finally {
    await sql`select public.crawl_finish_run(${runId}, ${sql.json({ state, error, ...counts })})`;
    await sql`select public.crawl_release(${SOURCE}, ${runId})`;
  }
  if (outcome !== 'collected') return 'served';

  await progress(sql, id, { status: 'aggregating' });
  try {
    const rebuilt = await rebuildStats();
    if (rebuilt === 'failed_sanity') await finish(sql, id, 'failed', 'Rebuilding the deck stats failed its sanity check.');
    else await finish(sql, id, 'done', null);
  } catch (err) {
    await finish(sql, id, 'failed', err instanceof Error ? err.message : String(err));
  }
  return 'served';
}
