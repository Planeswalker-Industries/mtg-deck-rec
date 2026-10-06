import {
  corpusVersion,
  EXCLUSIONS,
  loadCatalog,
  loadCorpusConfig,
  loadCorpusDecks,
  loadRoleCards,
} from '../lib/corpus';
import { connect, reserve } from '../lib/db';
import { cardStatRows, globalStatRows, identityMonths, keyStatRows, mergeBaseline, mergeKeyStats, tallyDecks } from '../lib/key-stats';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';
import { precomputeScores } from './precompute-scores';

const HEARTBEAT_EVERY = 2000;
/** A rebuild must keep at least this share of the previous run's decks, so a lost corpus can't wipe the stats. */
const MIN_DECK_SHARE = 0.8;
/** Where the decks come from, as sync_runs records it. */
const CORPUS_URI = 'postgres:corpus.decks';

/**
 * The full rebuild: the collated corpus.decks → commander_keys, commander_stats, card_global_stats,
 * commander_card_stats, corpus_identity_stats, then every serving score (precompute_scores). The precompute worker's
 * per-commander pass and nightly baseline (T055) write the same rows from the same code (lib/key-stats.ts), a
 * commander at a time; this one empties the dirty queue up to where it read.
 *
 * corpus.decks is written by the collator (T054) from every deck source; until the collator runs, it is empty and this
 * job refuses to write. Decks are checked again by `resolveDeck` for what changed since collation. Basic lands are left
 * out of the stats. A card's play rates count only decks updated in or after its release month. Same failure model as
 * the other syncs: stage, sanity-check, merge in one transaction.
 *
 * `force` re-runs an unchanged corpus and lets a much smaller corpus through the share check. It never lets an empty
 * corpus through: that would delete every stat.
 */
export async function aggregateCorpus({ force = false }: { force?: boolean } = {}): Promise<'succeeded' | 'skipped' | 'failed_sanity'> {
  const sql = connect();
  let runId: number | null = null;
  let decksRead = 0;

  try {
    // corpus.decks changes by writes (collated_at moves) and by deletions (the count moves); either means a rebuild.
    const version = await corpusVersion(sql);
    const [last] = await sql<{ decks: string | null }[]>`
      select metrics->>'decksRead' as decks from public.sync_runs
      where job = 'corpus_aggregate' and status = 'succeeded'
      order by started_at desc limit 1
    `;
    const countMoved = Number(last?.decks ?? -1) !== version.decks;
    const start = await startRun(sql, 'corpus_aggregate', { uri: CORPUS_URI, updatedAt: version.updatedAt }, force || countMoved);
    if (start.kind === 'skipped') {
      console.log('corpus_aggregate: corpus.decks is unchanged since the last successful run. Use --force to re-run.');
      return 'skipped';
    }
    const id = start.runId;
    runId = id;

    const config = await loadCorpusConfig(sql);
    const catalog = await loadCatalog(sql);
    const rolesByCard = await loadRoleCards(sql);
    // Every key is rebuilt, so every commander queued as dirty before this read is covered by it.
    const [queued] = await sql<{ seq: string | null }[]>`select max(seq)::text as seq from corpus.dirty_commanders`;

    const tally = await tallyDecks(loadCorpusDecks(sql), catalog, config, rolesByCard, async (n) => {
      decksRead = n;
      if (n % HEARTBEAT_EVERY === 0) await heartbeat(sql, id, n);
    });
    const { keys, excluded, eligibleDecks } = tally;
    decksRead = tally.decksRead;

    const globalWith = new Map<number, number>();
    for (const a of keys.values()) for (const [cardId, n] of a.cards) globalWith.set(cardId, (globalWith.get(cardId) ?? 0) + n);
    const monthsByIdentity = identityMonths(keys);
    const globalRows = globalStatRows(globalWith, monthsByIdentity, catalog);
    const baseline = new Map(globalRows.map((r) => [r.card_id, r.rate]));

    const keyRows = keyStatRows(keys);
    const cardRows = cardStatRows(keys, catalog, baseline, config.shrinkAlpha);

    const previousDecks = start.previousMetrics?.eligibleDecks;
    const metrics: SyncMetrics = {
      decksRead,
      eligibleDecks,
      commanderKeys: keyRows.length,
      commanderCardStats: cardRows.length,
      cardsWithStats: globalRows.length,
      ...Object.fromEntries(EXCLUSIONS.map((e) => [`excluded_${e}`, excluded[e]])),
    };

    const shrank = previousDecks !== undefined && previousDecks > 0 && eligibleDecks < previousDecks * MIN_DECK_SHARE;
    if (eligibleDecks === 0 || (!force && shrank)) {
      const error = `sanity gate: ${eligibleDecks} eligible decks (previous ${previousDecks ?? 'none'})`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: decksRead, metrics, error });
      console.error(
        eligibleDecks === 0
          ? `corpus_aggregate: ${error}. Nothing to count, so nothing is written; corpus.decks fills once the collator (T054) runs.`
          : `corpus_aggregate: ${error}. Live tables unchanged; re-run with --force if this is expected.`,
      );
      process.exitCode = 1;
      return 'failed_sanity';
    }

    const db = await reserve(sql);
    try {
      await db`begin`;
      try {
        const merged = await mergeKeyStats(db, keyRows, cardRows, { everyKey: true });
        await mergeBaseline(db, globalRows, monthsByIdentity);
        // Every commander queued before the decks were read has just been rebuilt.
        if (queued?.seq) await db`delete from corpus.dirty_commanders where seq <= ${queued.seq}::bigint`;
        console.log(
          `corpus_aggregate: ${merged.cardRowsWritten} commander-card rows written, ${merged.cardRowsRemoved} removed (of ${cardRows.length})`,
        );
        await db`commit`;
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
    }

    await finishRun(sql, runId, 'succeeded', { rowsRead: decksRead, rowsChanged: cardRows.length, metrics });
    // The run is recorded; a failure from here on is the scores' own.
    runId = null;
    const exclusions = EXCLUSIONS.filter((e) => excluded[e] > 0).map((e) => `${e} ${excluded[e]}`).join(', ') || 'none';
    console.log(
      `corpus_aggregate: ${eligibleDecks} of ${decksRead} decks counted (excluded: ${exclusions}); ` +
        `${keyRows.length} commander keys, ${cardRows.length} commander-card rows, baselines for ${globalRows.length} cards`,
    );
    // The serving scores rest on these stats; rebuild them now rather than leave the app reading the old ones.
    await precomputeScores({ sql });

    const sample = await sql<{ slug: string; deck_count: number; name: string; decks_with: number; synergy: number }[]>`
      with biggest as (select commander_key_id, deck_count from public.commander_stats order by deck_count desc limit 1)
      select k.slug, b.deck_count, c.name, s.decks_with, s.synergy
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
    return 'succeeded';
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: decksRead, error: err instanceof Error ? err.message : String(err) }).catch(
        () => {},
      );
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
