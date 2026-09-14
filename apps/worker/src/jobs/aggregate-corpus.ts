import { stat } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../lib/config';
import { connect } from '../lib/db';
import { readJsonl, type JsonlStats } from '../lib/jsonl';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';
import type { SlimDeck } from '../sources/archidekt/deck';

export const DEFAULT_CORPUS_FILE = path.join(DATA_DIR, 'archidekt', 'spike', 'decks.jsonl');

const BATCH_SIZE = 2000;
const HEARTBEAT_EVERY = 2000;
/** A rebuild must keep at least this share of the previous run's decks, so a truncated file can't wipe the stats. */
const MIN_DECK_SHARE = 0.8;
const MAX_PARSE_ERROR_RATE = 0.01;
const MAX_COMMANDERS = 2;
const IDENTITIES = 32;

const DEFAULT_CONFIG = { shrinkAlpha: 20, maxUnresolvedCards: 3 };
type CorpusConfig = typeof DEFAULT_CONFIG;

interface CatalogCard {
  id: number;
  colorIdentity: number;
  canBeCommander: boolean;
  legal: boolean;
  isBasicLand: boolean;
  slug: string;
}

const EXCLUSIONS = [
  'duplicate',
  'too_many_commanders',
  'commander_not_in_catalog',
  'commander_not_legal',
  'no_eligible_commander',
  'outside_identity',
  'unresolved_cards',
] as const;
type Exclusion = (typeof EXCLUSIONS)[number];

interface KeyAggregate {
  commanders: CatalogCard[];
  identity: number;
  decks: number;
  brackets: Record<string, number>;
  /** card id → decks running it */
  cards: Map<number, number>;
}

const increment = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

/**
 * Deck corpus → commander_keys, commander_stats, card_global_stats, commander_card_stats.
 *
 * A deck counts when its commanders (at most two, at least one able to lead) are in the catalog and legal, every card
 * fits their color identity, and no more than `maxUnresolvedCards` cards are missing from the catalog. Basic lands
 * are left out of the stats. Same failure model as the other syncs: stage, sanity-check, merge in one transaction.
 */
export async function aggregateCorpus({
  file = DEFAULT_CORPUS_FILE,
  source = 'archidekt',
  force = false,
}: { file?: string | undefined; source?: 'archidekt' | undefined; force?: boolean } = {}): Promise<void> {
  const fileStat = await stat(file);
  const sql = connect();
  let runId: number | null = null;
  const stats: JsonlStats = { lines: 0, parseErrors: 0 };

  try {
    const start = await startRun(sql, 'corpus_aggregate', { uri: `file://${file}`, updatedAt: fileStat.mtime.toISOString() }, force);
    if (start.kind === 'skipped') {
      console.log(`corpus_aggregate: ${file} is unchanged since the last successful run. Use --force to re-run.`);
      return;
    }
    runId = start.runId;

    const [configRow] = await sql<{ value: Partial<CorpusConfig> }[]>`select value from public.app_config where key = 'corpus'`;
    const config: CorpusConfig = { ...DEFAULT_CONFIG, ...configRow?.value };

    const catalogRows = await sql<
      {
        id: number;
        oracle_id: string;
        color_identity: number;
        can_be_commander: boolean;
        legal_commander: string;
        is_basic_land: boolean;
        slug: string;
      }[]
    >`
      select id, oracle_id::text, color_identity, can_be_commander, legal_commander, is_basic_land, slug
      from public.cards
      where deleted_at is null
    `;
    const catalog = new Map<string, CatalogCard>();
    const identityById = new Map<number, number>();
    for (const r of catalogRows) {
      catalog.set(r.oracle_id, {
        id: r.id,
        colorIdentity: r.color_identity,
        canBeCommander: r.can_be_commander,
        legal: r.legal_commander === 'legal',
        isBasicLand: r.is_basic_land,
        slug: r.slug,
      });
      identityById.set(r.id, r.color_identity);
    }
    if (catalog.size === 0) throw new Error('The card catalog is empty. Run sync:catalog first.');

    const keys = new Map<string, KeyAggregate>();
    const globalWith = new Map<number, number>();
    const decksByIdentity = new Array<number>(IDENTITIES).fill(0);
    const excluded = Object.fromEntries(EXCLUSIONS.map((e) => [e, 0])) as Record<Exclusion, number>;
    const seen = new Set<number>();
    let eligibleDecks = 0;

    for await (const deck of readJsonl<SlimDeck>(file, stats)) {
      if (stats.lines % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, stats.lines);
      const exclusion = ((): Exclusion | null => {
        if (seen.has(deck.id)) return 'duplicate';
        seen.add(deck.id);
        if (deck.commanders.length > MAX_COMMANDERS) return 'too_many_commanders';
        return null;
      })();
      if (exclusion) {
        excluded[exclusion]++;
        continue;
      }

      const commanders = deck.commanders.map((oracleId) => catalog.get(oracleId));
      if (!commanders.every((c): c is CatalogCard => c !== undefined)) {
        excluded.commander_not_in_catalog++;
        continue;
      }
      if (!commanders.every((c) => c.legal)) {
        excluded.commander_not_legal++;
        continue;
      }
      if (!commanders.some((c) => c.canBeCommander)) {
        excluded.no_eligible_commander++;
        continue;
      }

      const identity = commanders.reduce((mask, c) => mask | c.colorIdentity, 0);
      const cardIds = new Set<number>();
      let unresolved = 0;
      let outsideIdentity = false;
      for (const [oracleId] of deck.cards) {
        const card = catalog.get(oracleId);
        if (!card) {
          unresolved++;
        } else if ((card.colorIdentity & ~identity) !== 0) {
          outsideIdentity = true;
          break;
        } else if (!card.isBasicLand) {
          cardIds.add(card.id);
        }
      }
      if (outsideIdentity) {
        excluded.outside_identity++;
        continue;
      }
      if (unresolved > config.maxUnresolvedCards) {
        excluded.unresolved_cards++;
        continue;
      }

      commanders.sort((a, b) => a.id - b.id);
      const key = commanders.map((c) => c.id).join(':');
      let aggregate = keys.get(key);
      if (!aggregate) {
        aggregate = { commanders, identity, decks: 0, brackets: {}, cards: new Map() };
        keys.set(key, aggregate);
      }
      aggregate.decks++;
      const bracket = deck.edhBracket === null ? 'unset' : String(deck.edhBracket);
      aggregate.brackets[bracket] = (aggregate.brackets[bracket] ?? 0) + 1;
      for (const id of cardIds) {
        increment(aggregate.cards, id);
        increment(globalWith, id);
      }
      decksByIdentity[identity] = (decksByIdentity[identity] ?? 0) + 1;
      eligibleDecks++;
    }

    // A card's baseline counts only decks its color identity could appear in.
    const eligibleByIdentity = Array.from({ length: IDENTITIES }, (_, cardIdentity) =>
      decksByIdentity.reduce((sum, n, deckIdentity) => ((cardIdentity & ~deckIdentity) === 0 ? sum + n : sum), 0),
    );
    const baseline = new Map<number, number>();
    const globalRows = [...globalWith].map(([card_id, decks_with]) => {
      const eligible_decks = eligibleByIdentity[identityById.get(card_id) ?? 0] ?? eligibleDecks;
      const rate = decks_with / Math.max(eligible_decks, 1);
      baseline.set(card_id, rate);
      return { card_id, decks_with, eligible_decks, rate };
    });

    const keyRows = [...keys].map(([key, a]) => ({
      key,
      commander_1: a.commanders[0]?.id ?? 0,
      commander_2: a.commanders[1]?.id ?? null,
      color_identity: a.identity,
      slug: a.commanders.map((c) => c.slug).join('--'),
      deck_count: a.decks,
      bracket_counts: JSON.stringify(a.brackets),
    }));
    const alpha = config.shrinkAlpha;
    const cardStatRows = [...keys].flatMap(([key, a]) =>
      [...a.cards].map(([card_id, decks_with]) => {
        const p0 = baseline.get(card_id) ?? 0;
        const inclusion_shrunk = (decks_with + alpha * p0) / (a.decks + alpha);
        return { key, card_id, decks_with, inclusion_shrunk, synergy: inclusion_shrunk - p0 };
      }),
    );

    const errorRate = stats.lines > 0 ? stats.parseErrors / stats.lines : 1;
    const previousDecks = start.previousMetrics?.eligibleDecks;
    const metrics: SyncMetrics = {
      decksRead: stats.lines,
      eligibleDecks,
      commanderKeys: keyRows.length,
      commanderCardStats: cardStatRows.length,
      cardsWithStats: globalRows.length,
      parseErrors: stats.parseErrors,
      ...Object.fromEntries(EXCLUSIONS.map((e) => [`excluded_${e}`, excluded[e]])),
    };

    if (!force && (eligibleDecks === 0 || errorRate > MAX_PARSE_ERROR_RATE || (previousDecks && eligibleDecks < previousDecks * MIN_DECK_SHARE))) {
      const error = `sanity gate: ${eligibleDecks} eligible decks (previous ${previousDecks ?? 'none'}), parse error rate ${(errorRate * 100).toFixed(2)}%`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: stats.lines, metrics, error });
      console.error(`corpus_aggregate: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
      process.exitCode = 1;
      return;
    }

    const db = await sql.reserve();
    try {
      await db`
        create temp table stg_keys (
          key text primary key,
          commander_1 integer not null,
          commander_2 integer,
          color_identity smallint not null,
          slug text not null,
          deck_count integer not null,
          bracket_counts text not null
        )
      `;
      await db`
        create temp table stg_card_stats (
          key text not null,
          card_id integer not null,
          decks_with integer not null,
          inclusion_shrunk real not null,
          synergy real not null
        )
      `;
      await db`
        create temp table stg_global (
          card_id integer primary key,
          decks_with integer not null,
          eligible_decks integer not null,
          rate real not null
        )
      `;

      for (let i = 0; i < keyRows.length; i += BATCH_SIZE) {
        await db`insert into stg_keys ${db(keyRows.slice(i, i + BATCH_SIZE), 'key', 'commander_1', 'commander_2', 'color_identity', 'slug', 'deck_count', 'bracket_counts')}`;
      }
      for (let i = 0; i < cardStatRows.length; i += BATCH_SIZE) {
        await db`insert into stg_card_stats ${db(cardStatRows.slice(i, i + BATCH_SIZE), 'key', 'card_id', 'decks_with', 'inclusion_shrunk', 'synergy')}`;
        await heartbeat(sql, runId, stats.lines);
      }
      for (let i = 0; i < globalRows.length; i += BATCH_SIZE) {
        await db`insert into stg_global ${db(globalRows.slice(i, i + BATCH_SIZE), 'card_id', 'decks_with', 'eligible_decks', 'rate')}`;
      }

      await db`begin`;
      try {
        await db`
          insert into public.commander_keys (commander_1, commander_2, color_identity, slug)
          select commander_1, commander_2, color_identity, slug from stg_keys
          on conflict (commander_1, (coalesce(commander_2, 0))) do update
            set color_identity = excluded.color_identity, slug = excluded.slug
        `;
        await db`delete from public.commander_card_stats`;
        await db`delete from public.commander_stats`;
        await db`delete from public.card_global_stats`;
        await db`
          insert into public.commander_stats (commander_key_id, deck_count, source_counts, bracket_counts)
          select k.id, s.deck_count, jsonb_build_object(${source}::text, s.deck_count), s.bracket_counts::jsonb
          from stg_keys s
          join public.commander_keys k on k.commander_1 = s.commander_1 and coalesce(k.commander_2, 0) = coalesce(s.commander_2, 0)
        `;
        await db`
          insert into public.commander_card_stats (commander_key_id, card_id, decks_with, inclusion_shrunk, synergy)
          select k.id, s.card_id, s.decks_with, s.inclusion_shrunk, s.synergy
          from stg_card_stats s
          join stg_keys sk on sk.key = s.key
          join public.commander_keys k on k.commander_1 = sk.commander_1 and coalesce(k.commander_2, 0) = coalesce(sk.commander_2, 0)
        `;
        await db`
          insert into public.card_global_stats (card_id, decks_with, eligible_decks, rate)
          select card_id, decks_with, eligible_decks, least(rate, 1) from stg_global
        `;
        await db`commit`;
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
    }

    await finishRun(sql, runId, 'succeeded', { rowsRead: stats.lines, rowsChanged: cardStatRows.length, metrics });
    const exclusions = EXCLUSIONS.filter((e) => excluded[e] > 0).map((e) => `${e} ${excluded[e]}`).join(', ') || 'none';
    console.log(
      `corpus_aggregate: ${eligibleDecks} of ${stats.lines} decks counted (excluded: ${exclusions}); ` +
        `${keyRows.length} commander keys, ${cardStatRows.length} commander-card rows, baselines for ${globalRows.length} cards`,
    );

    const sample = await sql<{ slug: string; deck_count: number; name: string; decks_with: number; inclusion: number; synergy: number }[]>`
      with biggest as (select commander_key_id, deck_count from public.commander_stats order by deck_count desc limit 1)
      select k.slug, b.deck_count, c.name, s.decks_with, s.inclusion_shrunk as inclusion, s.synergy
      from biggest b
      join public.commander_keys k on k.id = b.commander_key_id
      join public.commander_card_stats s on s.commander_key_id = b.commander_key_id
      join public.cards c on c.id = s.card_id
      order by s.synergy desc
      limit 10
    `;
    if (sample[0]) console.log(`highest synergy for ${sample[0].slug} (${sample[0].deck_count} decks):`);
    for (const row of sample) {
      console.log(`  ${row.synergy.toFixed(2).padStart(5)}  in ${String(row.decks_with).padStart(3)} decks  ${row.name}`);
    }
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: stats.lines, error: err instanceof Error ? err.message : String(err) }).catch(
        () => {},
      );
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
