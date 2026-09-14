import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, REPORTS_DIR } from '../lib/config';
import { connect } from '../lib/db';
import { HttpError } from '../lib/http';
import { COMMANDER_FORMAT, COUNT_CAP, getDeck, listDecks, requestStats, ShapeError, type Deck } from '../sources/archidekt/client';
import { qualifyDeck, type RejectReason, type SlimDeck } from '../sources/archidekt/deck';

/*
 * Phase 0 corpus spike: how many qualifying Commander decks Archidekt has per commander, and how fast they can be
 * collected at one request per second. Noncommercial hobby use under Archidekt staff's permission to read the API
 * (https://archidekt.com/forum/thread/40353). Output stays on the local data drive and is used for aggregates only.
 */

const SPIKE_DIR = path.join(DATA_DIR, 'archidekt', 'spike');
/** v2 ranks from 100-card decks only; v1 (commander-rates.jsonl) was started before the size filter was found. */
const RATES_FILE = path.join(SPIKE_DIR, 'commander-rates-v2.jsonl');
const VERIFY_FILE = path.join(SPIKE_DIR, 'commander-verification.jsonl');
const COMMANDERS_FILE = path.join(SPIKE_DIR, 'commanders.json');
const DECKS_FILE = path.join(SPIKE_DIR, 'decks.jsonl');
const REJECTS_FILE = path.join(SPIKE_DIR, 'rejects.jsonl');

/** Which step wrote commanders.json. The crawl only runs from a verified ranking. */
const RATE_METHOD = 'size100-update-rate';
const VERIFIED_METHOD = 'size100-update-rate-x-commander-share';

/** Archidekt's deck list page size. A full first page means the commander has more decks than one page shows. */
const LIST_PAGE_SIZE = 60;
const DECK_SIZE = 100;
const MAX_CONSECUTIVE_SHAPE_ERRORS = 5;
const DAY_MS = 86_400_000;

/** Crawl order: most viewed decks (the community's picks) or most recently updated (the current card pool). */
export const CRAWL_ORDERS = { views: '-viewCount', updated: '-updatedAt' } as const;
export type CrawlOrder = keyof typeof CRAWL_ORDERS;
export const isCrawlOrder = (value: string | undefined): value is CrawlOrder => value === 'views' || value === 'updated';

interface RankedCommander {
  oracleId: string;
  name: string;
  /** Name that returned decks from Archidekt (a double-faced card may only match by its front face). */
  queryName: string;
  /** 100-card Commander decks that include the card. Exact below COUNT_CAP. */
  decks: number;
  /** Decks on the first list page (at most 60). */
  listed: number;
  /** How many of those decks get created or updated per day, estimated from the first page. */
  decksPerDay: number;
  /** Set by spike:archidekt:verify for the fastest-updating commanders. */
  verification?: {
    /** Sampled decks that have a commander: either this card or another. */
    checked: number;
    /** Of those, decks this card actually leads. */
    led: number;
    /** Smoothed share of listed decks this card leads. */
    share: number;
    adjustedDecksPerDay: number;
  };
}

interface Verification {
  oracleId: string;
  checked: number;
  led: number;
}

type FetchFailure = { ok: false; reason: 'unavailable' | 'shape_changed' };
type Outcome = ReturnType<typeof qualifyDeck> | FetchFailure;

interface RunStats {
  pages: number;
  listed: number;
  fetched: number;
  exhausted: boolean;
}

const minutes = (since: number) => ((Date.now() - since) / 60_000).toFixed(1);
const formatDeckCount = (decks: number) => (decks >= COUNT_CAP ? `${COUNT_CAP}+` : String(decks));

let consecutiveShapeErrors = 0;

async function fetchDeck(id: number): Promise<{ ok: true; deck: Deck } | FetchFailure> {
  try {
    const deck = await getDeck(id);
    consecutiveShapeErrors = 0;
    return { ok: true, deck };
  } catch (err) {
    // Deleted or made private between listing and fetching.
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return { ok: false, reason: 'unavailable' };
    if (err instanceof ShapeError) {
      console.warn(`deck ${id}: ${err.message}`);
      if (++consecutiveShapeErrors >= MAX_CONSECUTIVE_SHAPE_ERRORS) {
        throw new Error('Archidekt deck responses keep failing shape checks; stopping', { cause: err });
      }
      return { ok: false, reason: 'shape_changed' };
    }
    throw err;
  }
}

/** Reads a JSONL file written by this job, skipping a line cut short by a crash. */
function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      console.warn(`skipping unreadable line in ${file}`);
    }
  }
  return rows;
}

function formatCounts(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value} ${n}`).join(', ') || '-';
}

function readRanking(): { method?: string; commanders: RankedCommander[] } | null {
  return existsSync(COMMANDERS_FILE) ? (JSON.parse(readFileSync(COMMANDERS_FILE, 'utf8')) as { method?: string; commanders: RankedCommander[] }) : null;
}

/**
 * Estimates each commander's popularity on Archidekt from one request: how many 100-card decks include it, and how
 * long its 60 most recently updated ones took to accumulate. Candidates are the legal paper commanders in our
 * catalog. Counts include decks that only run the card in the 99; spike:archidekt:verify corrects for that.
 */
export async function rankCommanders(): Promise<void> {
  mkdirSync(SPIKE_DIR, { recursive: true });
  const sql = connect();
  const candidates = await sql<{ oracleId: string; name: string }[]>`
    select oracle_id::text as "oracleId", name
    from public.cards
    where can_be_commander and legal_commander = 'legal' and not is_digital_only and deleted_at is null
    order by name
  `.finally(() => sql.end({ timeout: 5 }));

  const ranked = new Map(readJsonl<RankedCommander>(RATES_FILE).map((r) => [r.oracleId, r]));
  const started = Date.now();
  console.log(`${candidates.length} candidate commanders, ${ranked.size} already ranked`);

  for (const [index, card] of candidates.entries()) {
    if (ranked.has(card.oracleId)) continue;

    let queryName = card.name;
    let listing = await listDecks({ page: 1, commanderName: queryName, size: DECK_SIZE });
    const frontFace = card.name.split(' // ')[0];
    if (listing.results.length === 0 && frontFace !== undefined && frontFace !== card.name) {
      queryName = frontFace;
      listing = await listDecks({ page: 1, commanderName: queryName, size: DECK_SIZE });
    }

    const oldest = listing.results.at(-1)?.updatedAt;
    let decksPerDay = 0;
    if (oldest !== undefined) {
      const days = (Date.now() - Date.parse(oldest)) / DAY_MS;
      // A full page is a real rate. A short page is every deck there is, so spread it over at least a week to keep
      // one freshly edited deck from looking popular.
      const floorDays = listing.results.length >= LIST_PAGE_SIZE ? 1 / 24 : 7;
      decksPerDay = listing.results.length / Math.max(days, floorDays);
    }

    const row: RankedCommander = {
      oracleId: card.oracleId,
      name: card.name,
      queryName,
      decks: listing.count,
      listed: listing.results.length,
      decksPerDay,
    };
    appendFileSync(RATES_FILE, `${JSON.stringify(row)}\n`);
    ranked.set(card.oracleId, row);
    if ((index + 1) % 100 === 0) {
      console.log(`${index + 1}/${candidates.length} ranked, ${requestStats.requests} requests (${requestStats.retries} retries), ${minutes(started)} min`);
    }
  }

  const commanders = candidates
    .map((card) => ranked.get(card.oracleId))
    .filter((c): c is RankedCommander => c !== undefined && c.listed > 0)
    .sort((a, b) => b.decksPerDay - a.decksPerDay || a.name.localeCompare(b.name));
  writeFileSync(
    COMMANDERS_FILE,
    JSON.stringify({ method: RATE_METHOD, rankedAt: new Date().toISOString(), candidates: candidates.length, commanders }, null, 2),
  );
  console.log(
    `${commanders.length} of ${candidates.length} commanders have 100-card Archidekt decks; ${requestStats.requests} requests ` +
      `(${requestStats.retries} retries) in ${minutes(started)} min → ${COMMANDERS_FILE}`,
  );
  for (const [i, c] of commanders.slice(0, 50).entries()) {
    console.log(`  ${String(i + 1).padStart(2)}  ${c.decksPerDay.toFixed(1).padStart(6)}/day  ${formatDeckCount(c.decks).padStart(5)} decks  ${c.name}`);
  }
}

/**
 * The commander filter also returns decks that only run the card in the 99, which inflates legends popular as
 * support cards. Checks the newest few decks of each of the fastest-updating commanders and discounts its rate by
 * the share it actually leads. Decks that qualify along the way are kept for the crawl.
 */
export async function verifyCommanders({
  top = 100,
  decksEach = 5,
}: { top?: number | undefined; decksEach?: number | undefined } = {}): Promise<void> {
  const ranking = readRanking();
  if (!ranking || (ranking.method !== RATE_METHOD && ranking.method !== VERIFIED_METHOD)) {
    throw new Error(`Run spike:archidekt:rank first (${COMMANDERS_FILE} is missing or from an older ranking)`);
  }
  const byRate = [...ranking.commanders].sort((a, b) => b.decksPerDay - a.decksPerDay || a.name.localeCompare(b.name));
  const toVerify = byRate.slice(0, top);

  const results = new Map(readJsonl<Verification>(VERIFY_FILE).map((v) => [v.oracleId, v]));
  const seen = new Set<number>([
    ...readJsonl<{ id: number }>(DECKS_FILE).map((d) => d.id),
    ...readJsonl<{ id: number }>(REJECTS_FILE).map((r) => r.id),
  ]);
  const started = Date.now();

  for (const [index, target] of toVerify.entries()) {
    if (results.has(target.oracleId)) continue;
    const listing = await listDecks({ page: 1, commanderName: target.queryName, size: DECK_SIZE });
    const result: Verification = { oracleId: target.oracleId, checked: 0, led: 0 };

    for (const summary of listing.results.filter((s) => s.deckFormat === COMMANDER_FORMAT).slice(0, decksEach)) {
      const fetched = await fetchDeck(summary.id);
      if (!fetched.ok) continue;
      const outcome = qualifyDeck(fetched.deck, target.oracleId);
      const leads = outcome.ok || outcome.reason === 'not_100_cards';
      const ledByAnother = !outcome.ok && outcome.reason === 'wrong_commander';
      if (leads || ledByAnother) result.checked++;
      if (leads) result.led++;

      // Keep what the crawl can reuse. A deck led by another commander stays unrecorded so the crawl can still claim it.
      if (seen.has(summary.id) || ledByAnother) continue;
      seen.add(summary.id);
      if (outcome.ok) appendFileSync(DECKS_FILE, `${JSON.stringify(outcome.deck)}\n`);
      else appendFileSync(REJECTS_FILE, `${JSON.stringify({ id: summary.id, listedFor: target.oracleId, reason: outcome.reason })}\n`);
    }

    appendFileSync(VERIFY_FILE, `${JSON.stringify(result)}\n`);
    results.set(target.oracleId, result);
    console.log(
      `[${index + 1}/${toVerify.length}] ${target.name}: leads ${result.led} of ${result.checked} ` +
        `(${requestStats.requests} requests, ${requestStats.retries} retries, ${minutes(started)} min)`,
    );
  }

  const verified = toVerify
    .map((c): RankedCommander => {
      const v = results.get(c.oracleId) ?? { checked: 0, led: 0 };
      // Smoothed so a 0-of-2 sample doesn't zero a commander out.
      const share = (v.led + 1) / (v.checked + 2);
      return { ...c, verification: { checked: v.checked, led: v.led, share, adjustedDecksPerDay: c.decksPerDay * share } };
    })
    .sort(
      (a, b) =>
        (b.verification?.adjustedDecksPerDay ?? 0) - (a.verification?.adjustedDecksPerDay ?? 0) || a.name.localeCompare(b.name),
    );
  const rest = byRate
    .slice(top)
    .map(({ oracleId, name, queryName, decks, listed, decksPerDay }): RankedCommander => ({ oracleId, name, queryName, decks, listed, decksPerDay }));

  writeFileSync(
    COMMANDERS_FILE,
    JSON.stringify(
      { method: VERIFIED_METHOD, rankedAt: new Date().toISOString(), verifiedTop: top, commanders: [...verified, ...rest] },
      null,
      2,
    ),
  );
  console.log(`verified ${toVerify.length} commanders; ${requestStats.requests} requests in ${minutes(started)} min → ${COMMANDERS_FILE}`);
  for (const [i, c] of verified.slice(0, 50).entries()) {
    const v = c.verification;
    console.log(
      `  ${String(i + 1).padStart(2)}  ${(v?.adjustedDecksPerDay ?? 0).toFixed(1).padStart(6)}/day  ` +
        `${formatDeckCount(c.decks).padStart(5)} decks  leads ${v?.led ?? 0}/${v?.checked ?? 0}  ${c.name}`,
    );
  }
}

/**
 * Collects up to `perCommander` qualifying decks for each of the top ranked commanders, most viewed first by default.
 * Every deck outcome is appended as it happens, so an interrupted run resumes where it stopped.
 */
export async function crawlCommanders({
  commanders: limit = 50,
  perCommander = 300,
  maxPages = 80,
  order = 'views',
}: {
  commanders?: number | undefined;
  perCommander?: number | undefined;
  maxPages?: number | undefined;
  order?: CrawlOrder | undefined;
} = {}): Promise<void> {
  const ranking = readRanking();
  if (!ranking || ranking.method !== VERIFIED_METHOD) {
    throw new Error(`Run spike:archidekt:rank and spike:archidekt:verify first (${COMMANDERS_FILE} is missing or unverified)`);
  }
  const targets = ranking.commanders.slice(0, limit);
  const targetIds = new Set(targets.map((t) => t.oracleId));

  const decks = readJsonl<SlimDeck>(DECKS_FILE);
  const seen = new Set<number>([...decks.map((d) => d.id), ...readJsonl<{ id: number }>(REJECTS_FILE).map((r) => r.id)]);
  const run = new Map<string, RunStats>();
  const started = Date.now();
  let acceptedThisRun = 0;

  try {
    for (const [index, target] of targets.entries()) {
      let accepted = decks.filter((d) => d.commanders.includes(target.oracleId)).length;
      const stats: RunStats = { pages: 0, listed: 0, fetched: 0, exhausted: false };
      run.set(target.oracleId, stats);

      for (let page = 1; accepted < perCommander && page <= maxPages; page++) {
        const listing = await listDecks({ page, commanderName: target.queryName, size: DECK_SIZE, orderBy: CRAWL_ORDERS[order] });
        stats.pages++;
        stats.listed += listing.results.length;

        for (const summary of listing.results) {
          if (accepted >= perCommander) break;
          if (seen.has(summary.id) || summary.deckFormat !== COMMANDER_FORMAT) continue;
          seen.add(summary.id);
          stats.fetched++;

          const fetched = await fetchDeck(summary.id);
          let outcome: Outcome = fetched.ok ? qualifyDeck(fetched.deck, target.oracleId) : fetched;
          // The commander filter also returns decks that only include the card. Keep one if it leads for another target.
          if (fetched.ok && !outcome.ok && outcome.reason === 'wrong_commander') {
            const other = qualifyDeck(fetched.deck);
            if (other.ok && other.deck.commanders.some((id) => targetIds.has(id))) outcome = other;
          }

          if (outcome.ok) {
            appendFileSync(DECKS_FILE, `${JSON.stringify(outcome.deck)}\n`);
            decks.push(outcome.deck);
            acceptedThisRun++;
            if (outcome.deck.commanders.includes(target.oracleId)) accepted++;
          } else {
            const reject: { id: number; listedFor: string; reason: RejectReason | FetchFailure['reason'] } = {
              id: summary.id,
              listedFor: target.oracleId,
              reason: outcome.reason,
            };
            appendFileSync(REJECTS_FILE, `${JSON.stringify(reject)}\n`);
          }
        }

        if (!listing.hasNext) {
          stats.exhausted = true;
          break;
        }
      }
      console.log(
        `[${index + 1}/${targets.length}] ${target.name}: ${accepted} qualifying, ${stats.fetched} fetched over ` +
          `${stats.pages} pages (${requestStats.requests} requests, ${requestStats.retries} retries, ${minutes(started)} min)`,
      );
    }
  } finally {
    writeReport({ targets, decks, run, perCommander, order, started, acceptedThisRun });
  }
}

function writeReport({
  targets,
  decks,
  run,
  perCommander,
  order,
  started,
  acceptedThisRun,
}: {
  targets: RankedCommander[];
  decks: SlimDeck[];
  run: Map<string, RunStats>;
  perCommander: number;
  order: CrawlOrder;
  started: number;
  acceptedThisRun: number;
}): void {
  const rejects = readJsonl<{ id: number; listedFor: string; reason: string }>(REJECTS_FILE);
  const hours = Math.max((Date.now() - started) / 3_600_000, 1 / 3600);
  const fetchedThisRun = [...run.values()].reduce((sum, s) => sum + s.fetched, 0);
  const date = new Date().toISOString().slice(0, 10);

  const rows = targets.map((target) => {
    const mine = decks.filter((d) => d.commanders.includes(target.oracleId));
    const oldest = mine.reduce<string | null>((o, d) => (o === null || d.updatedAt < o ? d.updatedAt : o), null);
    const stats = run.get(target.oracleId);
    const rejected = formatCounts(rejects.filter((r) => r.listedFor === target.oracleId).map((r) => r.reason));
    const brackets = formatCounts(mine.map((d) => (d.edhBracket === null ? 'unset' : `B${d.edhBracket}`)));
    const leads = target.verification ? `${target.verification.led}/${target.verification.checked}` : '-';
    return {
      count: mine.length,
      line:
        `| ${target.name} | ${formatDeckCount(target.decks)} | ${target.decksPerDay.toFixed(1)} | ${leads} | ${mine.length} | ` +
        `${mine.length >= perCommander ? 'yes' : 'no'} | ${stats?.exhausted ? 'yes' : 'no'} | ${stats?.fetched ?? 0} | ` +
        `${rejected} | ${brackets} | ${oldest?.slice(0, 10) ?? '-'} |`,
    };
  });
  const under50 = rows.filter((r) => r.count < 50).length;

  const report = [
    `# Archidekt corpus spike (${date})`,
    '',
    'Deck data from [Archidekt](https://archidekt.com), collected for noncommercial aggregate statistics only.',
    '',
    `- Decks taken ${order === 'views' ? 'most viewed' : 'most recently updated'} first, 100-card Commander decks only.`,
    `- This run: ${requestStats.requests} requests, ${requestStats.retries} retries ${JSON.stringify(requestStats.retryStatuses)}, ` +
      `${(hours * 60).toFixed(1)} min.`,
    `- Throughput: ${Math.round(fetchedThisRun / hours)} decks fetched and ${Math.round(acceptedThisRun / hours)} qualifying per hour ` +
      `(${Math.round((acceptedThisRun / hours) * 24)} qualifying per day; kill criterion is under 20,000).`,
    `- Stored in total: ${decks.length} qualifying decks, ${rejects.length} rejected.`,
    `- Commanders with fewer than 50 qualifying decks: ${under50} of ${targets.length} (kill criterion: more than half).`,
    '',
    '| Commander | 100-card decks listed | Updated per day | Leads sampled decks | Qualifying decks | Reached target | Listing exhausted | Fetched this run | Rejected (listed for it) | Brackets | Oldest qualifying update |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => r.line),
    '',
  ].join('\n');

  mkdirSync(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, `archidekt-spike-${date}.md`);
  writeFileSync(file, report);
  console.log(`report → ${file}`);
}
