import { loadCorpusConfig } from '../lib/corpus';
import type { Sql } from '../lib/db';
import { startCrawl } from '../lib/search-api';
import { aggregateCorpus } from './aggregate-corpus';
import { collate } from './collate';

/**
 * Deck lookups (contract v2; T009, served by the VPS worker since T066). A visitor whose commander has no decks of
 * ours asks for some; the request waits in public.commander_requests. Lookups go through the crawl rather than a
 * client of their own: crawl_next_commanders puts a requested commander at the front of the crawl's queue, this module
 * starts a crawl run when none is going, and once the crawl has visited the commander it collates, rebuilds the stats
 * and closes the request. So a lookup obeys the crawl's pace, claim and kill switch, and Archidekt sees one client.
 *
 * A request moves queued → collecting → aggregating → done or not_enough_decks, or failed. Its state lives in the
 * database, so a restarted worker carries on where the last one stopped.
 */

/** The heartbeat name the web app reads (public.commander_collector_online). */
export const WORKER_NAME = 'commander-requests';
/** The source lookups are served from; the crawl's only active source. */
const LOOKUP_SOURCE = 'archidekt';
/** Visit outcomes that mean Archidekt has no decks led by the commander under any name the crawl tried. */
const NOTHING_FOUND = new Set(['not_found', 'no_led_decks']);
/** The crawl never hands this commander out again until a person clears it, so a lookup can't wait for a visit. */
const NEVER_REVISITED = 'not_found';
const MS_PER_MINUTE = 60_000;

interface LookupConfig {
  visitTimeoutMinutes: number;
  crawlTriggerMinutes: number;
}

/** Defaults for a database without the T066 settings. */
const DEFAULT_CONFIG: LookupConfig = { visitTimeoutMinutes: 90, crawlTriggerMinutes: 10 };

type Final = 'done' | 'not_enough_decks' | 'failed';

interface ActiveRequest {
  id: string;
  commander_card_id: number;
  status: 'collecting' | 'aggregating';
  started_at: Date;
  last_visited_at: Date | null;
  last_run_id: string | null;
  outcome: string | null;
  listed: number | null;
}

export async function checkIn(sql: Sql): Promise<void> {
  await sql`
    insert into public.worker_status (name, heartbeat_at) values (${WORKER_NAME}, now())
    on conflict (name) do update set heartbeat_at = now()
  `;
}

async function finish(sql: Sql, id: string, status: Final, fields: { error?: string; listed?: number | null; collected?: number }) {
  await sql`
    update public.commander_requests
    set status = ${status}::public.commander_request_status,
        error = ${fields.error ?? null},
        decks_listed = coalesce(${fields.listed ?? null}::integer, decks_listed),
        decks_collected = coalesce(${fields.collected ?? null}::integer, decks_collected),
        finished_at = now(), heartbeat_at = now(), updated_at = now()
    where id = ${id}
  `;
  console.log(`lookup ${id}: ${status}${fields.error ? ` (${fields.error})` : ''}`);
}

let lastTrigger = 0;

/**
 * Starts a crawl run unless one is going or one was asked for in the last `crawlTriggerMinutes`. Shared by lookups
 * and the daily crawl, so neither asks twice in a row.
 */
export async function triggerCrawl(source: string, everyMinutes: number): Promise<void> {
  if (Date.now() - lastTrigger < everyMinutes * MS_PER_MINUTE) return;
  lastTrigger = Date.now();
  const result = await startCrawl(source);
  if (result === null) console.warn(`crawl ${source}: SEARCH_API_URL and a crawl token are not set, so no crawl can be started.`);
  else console.log(`crawl ${source}: ${result.started ? 'started' : `not started (${result.reason ?? 'no reason given'})`}`);
}

async function loadConfig(sql: Sql): Promise<LookupConfig> {
  const [row] = await sql<{ value: Partial<LookupConfig> }[]>`select value from public.app_config where key = 'commander_requests'`;
  return { ...DEFAULT_CONFIG, ...row?.value };
}

/** One pass over the deck lookups: start new ones, follow the crawl, close the ones it has visited. */
export async function serveLookups(sql: Sql): Promise<void> {
  const config = await loadConfig(sql);
  // The old worker's 'checking' step is the crawl's job now.
  await sql`
    update public.commander_requests
    set status = 'collecting', started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
    where status in ('queued', 'checking')
  `;
  const active = await sql<ActiveRequest[]>`
    select r.id::text, r.commander_card_id, r.status, r.started_at, q.last_visited_at, q.last_run_id::text, q.outcome, q.listed
    from public.commander_requests r
    left join crawl.queue q on q.source = ${LOOKUP_SOURCE} and q.commander_card_id = r.commander_card_id
    where r.status in ('collecting', 'aggregating')
    order by r.created_at
  `;
  if (active.length === 0) return;
  await sql`update public.commander_requests set heartbeat_at = now() where status in ('collecting', 'aggregating')`;

  const [state] = await sql<{ disabled: boolean; disabled_reason: string | null; running_run_id: string | null }[]>`
    select disabled, disabled_reason, running_run_id::text from crawl.state where source = ${LOOKUP_SOURCE}
  `;
  if (!state || state.disabled) {
    const reason = state ? `Archidekt is switched off (${state.disabled_reason ?? 'no reason recorded'}).` : 'The crawl is not set up.';
    for (const r of active) await finish(sql, r.id, 'failed', { error: reason });
    return;
  }

  const ready: ActiveRequest[] = [];
  let waiting = 0;
  for (const r of active) {
    // A visit after the request, or one earlier in the run that is going now: that run won't hand the commander out again,
    // and the decks it collected are already in raw.
    const visited =
      r.last_visited_at !== null &&
      (r.last_visited_at >= r.started_at || (state.running_run_id !== null && r.last_run_id === state.running_run_id));
    const nothingFound = r.outcome === NEVER_REVISITED || (visited && NOTHING_FOUND.has(r.outcome ?? ''));
    if (r.status === 'aggregating') ready.push(r);
    else if (nothingFound) await finish(sql, r.id, 'not_enough_decks', { listed: r.listed ?? 0, collected: 0 });
    else if (visited) ready.push(r);
    else if (Date.now() - r.started_at.getTime() > config.visitTimeoutMinutes * MS_PER_MINUTE) {
      await finish(sql, r.id, 'failed', { error: 'The crawl did not reach this commander in time.' });
    } else waiting++;
  }
  if (waiting > 0 && state.running_run_id === null) await triggerCrawl(LOOKUP_SOURCE, config.crawlTriggerMinutes);
  if (ready.length === 0) return;

  // The crawl has their decks: collate them, rebuild the stats once for all of them, then report.
  const ids = ready.map((r) => r.id);
  await sql`
    update public.commander_requests set status = 'aggregating', heartbeat_at = now(), updated_at = now()
    where id = any (${ids}::bigint[])
  `;
  await collate({ only: [LOOKUP_SOURCE] });
  const rebuilt = await aggregateCorpus();
  if (rebuilt === 'failed_sanity') {
    for (const r of ready) await finish(sql, r.id, 'failed', { error: 'Rebuilding the deck stats failed its sanity check.' });
    return;
  }
  // Enough decks of its own for play rates, the same bar the recommendations use.
  const { minDecks } = await loadCorpusConfig(sql);
  for (const r of ready) {
    const [held] = await sql<{ n: number }[]>`
      select count(*)::int as n from corpus.decks where ${r.commander_card_id}::integer = any (commander_card_ids)
    `;
    const collected = held?.n ?? 0;
    await finish(sql, r.id, collected >= minDecks ? 'done' : 'not_enough_decks', { listed: r.listed, collected });
  }
}
