import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_CORPUS_FILE, DEFAULT_REJECTS_FILE, loadCorpusConfig } from '../lib/corpus';
import { connect, type Sql } from '../lib/db';
import { HttpError } from '../lib/http';
import { readJsonl } from '../lib/jsonl';
import { COMMANDER_FORMAT, getDeck, listDecks, RateLimitedError, ShapeError, type Deck } from '../sources/archidekt/client';
import { qualifyDeck, type SlimDeck } from '../sources/archidekt/deck';
import { aggregateCorpus } from './aggregate-corpus';

const WORKER_NAME = 'commander-requests';
const POLL_MS = 5_000;
/** A lookup whose worker hasn't checked in for this long goes back in line. */
const STALE_AFTER = '10 minutes';
const DECK_SIZE = 100;
const MAX_PAGES = 40;

interface ClaimedRequest {
  id: string;
  commander_card_id: number;
  decks_target: number;
}

type FinalStatus = 'done' | 'not_enough_decks' | 'failed';

async function checkIn(sql: Sql): Promise<void> {
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

/** Deck ids already stored or rejected, and how many stored decks the commander already leads. */
async function corpusProgress(oracleId: string): Promise<{ seen: Set<number>; led: number }> {
  const seen = new Set<number>();
  let led = 0;
  if (existsSync(DEFAULT_CORPUS_FILE)) {
    for await (const deck of readJsonl<SlimDeck>(DEFAULT_CORPUS_FILE)) {
      seen.add(deck.id);
      if (deck.commanders.includes(oracleId)) led++;
    }
  }
  if (existsSync(DEFAULT_REJECTS_FILE)) {
    for await (const reject of readJsonl<{ id: number }>(DEFAULT_REJECTS_FILE)) seen.add(reject.id);
  }
  return { seen, led };
}

async function fetchDeck(id: number): Promise<Deck | null> {
  try {
    return await getDeck(id);
  } catch (err) {
    // Deleted or made private since it was listed, or a response we can't read: skip it.
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return null;
    if (err instanceof ShapeError) {
      console.warn(`deck ${id}: ${err.message}`);
      return null;
    }
    throw err;
  }
}

async function serveRequest(sql: Sql, id: number, request: ClaimedRequest): Promise<void> {
  const [commander] = await sql<{ name: string; oracle_id: string }[]>`
    select name, oracle_id::text from public.cards where id = ${request.commander_card_id} and deleted_at is null
  `;
  if (!commander) return finish(sql, id, 'failed', 'That commander is no longer in the card catalog.');
  const config = await loadCorpusConfig(sql);
  const target = request.decks_target;
  console.log(`commander request ${id}: ${commander.name}, up to ${target} decks`);

  const listPage = (page: number) => listDecks({ page, commanderName: commander.name, size: DECK_SIZE, orderBy: '-viewCount' });
  let listing = await listPage(1);
  await progress(sql, id, { status: 'collecting', decksListed: listing.count, decksCollected: 0 });
  if (listing.count < config.minDecks) return finish(sql, id, 'not_enough_decks', null);

  const { seen, led } = await corpusProgress(commander.oracle_id);
  let collected = led;
  await progress(sql, id, { decksCollected: Math.min(collected, target) });

  for (let page = 1; collected < target && page <= MAX_PAGES; page++) {
    if (page > 1) listing = await listPage(page);
    for (const summary of listing.results) {
      if (collected >= target) break;
      if (seen.has(summary.id) || summary.deckFormat !== COMMANDER_FORMAT) continue;
      seen.add(summary.id);
      const deck = await fetchDeck(summary.id);
      if (!deck) continue;
      const outcome = qualifyDeck(deck, commander.oracle_id);
      if (outcome.ok) {
        appendFileSync(DEFAULT_CORPUS_FILE, `${JSON.stringify(outcome.deck)}\n`);
        collected++;
        await progress(sql, id, { decksCollected: collected });
      } else {
        appendFileSync(DEFAULT_REJECTS_FILE, `${JSON.stringify({ id: summary.id, listedFor: commander.oracle_id, reason: outcome.reason })}\n`);
      }
    }
    if (!listing.hasNext) break;
  }

  if (collected < config.minDecks) return finish(sql, id, 'not_enough_decks', null, collected);
  await progress(sql, id, { status: 'aggregating', decksCollected: Math.min(collected, target) });
  const rebuilt = await aggregateCorpus({ force: true });
  if (rebuilt !== 'succeeded') return finish(sql, id, 'failed', 'Rebuilding the deck stats failed its sanity check.');
  await finish(sql, id, 'done', null);
}

/**
 * Serves commander deck lookups from the web app, one at a time: checks how many decks Archidekt lists for the commander,
 * collects the most viewed qualifying ones at the Archidekt client's polite pace, then rebuilds the corpus stats.
 * Progress goes to public.commander_requests for the deck tool to show. Runs until stopped; `once` exits when the queue
 * is empty.
 */
export async function serveCommanderRequests({ once = false }: { once?: boolean } = {}): Promise<void> {
  const sql = connect();
  console.log(`commander requests: serving${once ? ' until the queue is empty' : ' (Ctrl+C to stop)'}`);
  try {
    for (;;) {
      await checkIn(sql);
      // A lookup whose worker died goes back in line; decks it already stored still count toward its target.
      await sql`
        update public.commander_requests
        set status = 'queued', updated_at = now()
        where status in ('checking', 'collecting', 'aggregating') and heartbeat_at < now() - ${STALE_AFTER}::interval
      `;
      const [claimed] = await sql<ClaimedRequest[]>`
        update public.commander_requests
        set status = 'checking', started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
        where id = (
          select id from public.commander_requests where status = 'queued' order by created_at limit 1 for update skip locked
        )
        returning id::text, commander_card_id, decks_target
      `;
      if (!claimed) {
        if (once) return;
        await sleep(POLL_MS);
        continue;
      }

      const id = Number(claimed.id);
      try {
        await serveRequest(sql, id, claimed);
      } catch (err) {
        console.error(`commander request ${id} failed:`, err);
        const message = err instanceof RateLimitedError ? 'Archidekt is busy right now.' : err instanceof Error ? err.message : String(err);
        await finish(sql, id, 'failed', message);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
