import { IDENTITIES, loadCatalog, loadCorpusConfig, loadRoleCards, type CorpusDeck } from '../lib/corpus';
import type { Sql } from '../lib/db';
import { cardStatRows, globalStatRows, keyStatRows, mergeBaseline, mergeKeyStats, tallyDecks } from '../lib/key-stats';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';
import { precomputeScores } from './precompute-scores';

/**
 * The precompute worker's two corpus passes (T055, card-graph-plan.md "Precompute worker"):
 *
 * - per commander, after each collation: the commanders whose decks changed (corpus.dirty_commanders, filled by the
 *   collator's triggers) get their commander_keys, commander_stats and commander_card_stats rebuilt from their own
 *   decks, then their scores. Their cards shrink toward the last nightly baseline.
 * - nightly: the baseline (card_global_stats, corpus_identity_stats) summed from the per-commander stats, every
 *   commander's shrunk inclusion against it, then every score.
 *
 * `aggregate:corpus` stays as the full rebuild from every deck; the three write the same rows.
 */

/** Commanders rebuilt per transaction. */
const COMMANDERS_PER_BATCH = 50;
/** One pass takes at most this many commanders; the rest wait for the next pass, so a lookup never waits on a backlog. */
const MAX_COMMANDERS_PER_PASS = 2000;
/** The nightly baseline must keep at least this share of the last one's decks, as aggregate:corpus does. */
const MIN_DECK_SHARE = 0.8;
/** Shrunk inclusion and synergy moving less than this aren't rewritten, as in aggregate:corpus. */
const SHRINK_TOLERANCE = 0.001;
const DIRTY_URI = 'postgres:corpus.dirty_commanders';
const BASELINE_URI = 'postgres:public.commander_card_stats';

interface Dirty {
  commander_1: number;
  commander_2: number;
  seq: string;
}

/** The decks of these commanders (or pairs), in id order, so the first copy of a cross-posted deck is the one counted. */
async function* decksOf(sql: Sql, batch: readonly Dirty[]): AsyncGenerator<CorpusDeck> {
  const rows = await sql<
    { source: string; source_deck_id: string; commander_card_ids: number[]; card_ids: number[]; month: string; content_hash: string }[]
  >`
    select d.source, d.source_deck_id, d.commander_card_ids, d.card_ids, to_char(d.updated_month, 'YYYY-MM') as month,
           encode(d.content_hash, 'hex') as content_hash
    from unnest(${batch.map((b) => b.commander_1)}::int[], ${batch.map((b) => b.commander_2)}::int[]) as k (c1, c2)
    join corpus.decks d on d.commander_card_ids = (case when k.c2 = 0 then array[k.c1] else array[k.c1, k.c2] end)
    order by d.id
  `;
  for (const r of rows) {
    yield {
      source: r.source,
      sourceDeckId: r.source_deck_id,
      commanderIds: r.commander_card_ids,
      cardIds: r.card_ids,
      month: r.month,
      contentHash: r.content_hash,
    };
  }
}

/**
 * Rebuilds the stats of the commanders whose decks changed, then their scores. Returns how many commanders it took;
 * an empty queue costs one indexed read and records no run.
 */
export async function precomputeCommanders(sql: Sql): Promise<{ commanders: number }> {
  const dirty = await sql<Dirty[]>`
    select commander_1, commander_2, seq::text as seq from corpus.dirty_commanders order by seq limit ${MAX_COMMANDERS_PER_PASS}
  `;
  if (dirty.length === 0) return { commanders: 0 };

  const start = await startRun(sql, 'precompute_commanders', { uri: DIRTY_URI, updatedAt: new Date().toISOString() }, true);
  if (start.kind === 'skipped') return { commanders: 0 };
  const runId = start.runId;
  const metrics: SyncMetrics = { commanders: 0, emptied: 0, decksRead: 0, cardRowsWritten: 0, cardRowsRemoved: 0 };
  try {
    const [config, catalog, rolesByCard, baselineRows] = await Promise.all([
      loadCorpusConfig(sql),
      loadCatalog(sql),
      loadRoleCards(sql),
      sql<{ card_id: number; rate: number }[]>`select card_id, rate from public.card_global_stats`,
    ]);
    const baseline = new Map(baselineRows.map((r) => [r.card_id, r.rate]));

    for (let i = 0; i < dirty.length; i += COMMANDERS_PER_BATCH) {
      const batch = dirty.slice(i, i + COMMANDERS_PER_BATCH);
      const tally = await tallyDecks(decksOf(sql, batch), catalog, config, rolesByCard);
      const counted = new Set([...tally.keys.values()].map((a) => `${a.commanders[0]?.id ?? 0}:${a.commanders[1]?.id ?? 0}`));
      const emptied = batch.filter((b) => !counted.has(`${b.commander_1}:${b.commander_2}`)).map((b) => [b.commander_1, b.commander_2] as const);
      const keyRows = keyStatRows(tally.keys);
      const cardRows = cardStatRows(tally.keys, catalog, baseline, config.shrinkAlpha);

      const db = await sql.reserve();
      try {
        await db`begin`;
        try {
          const merged = await mergeKeyStats(db, keyRows, cardRows, { everyKey: false, emptied });
          // Only the queue rows read: a commander queued again since keeps its row for the next pass.
          await db`
            delete from corpus.dirty_commanders d
            using unnest(${batch.map((b) => b.commander_1)}::int[], ${batch.map((b) => b.commander_2)}::int[], ${batch.map((b) => b.seq)}::bigint[]) as r (c1, c2, seq)
            where d.commander_1 = r.c1 and d.commander_2 = r.c2 and d.seq = r.seq
          `;
          await db`commit`;
          metrics.cardRowsWritten = (metrics.cardRowsWritten ?? 0) + merged.cardRowsWritten;
          metrics.cardRowsRemoved = (metrics.cardRowsRemoved ?? 0) + merged.cardRowsRemoved;
        } catch (err) {
          await db`rollback`.catch(() => {});
          throw err;
        }
      } finally {
        db.release();
      }
      metrics.commanders = (metrics.commanders ?? 0) + batch.length;
      metrics.emptied = (metrics.emptied ?? 0) + emptied.length;
      metrics.decksRead = (metrics.decksRead ?? 0) + tally.decksRead;
      await heartbeat(sql, runId, metrics.commanders ?? 0);
    }
    await finishRun(sql, runId, 'succeeded', {
      rowsRead: metrics.decksRead ?? 0,
      rowsChanged: (metrics.cardRowsWritten ?? 0) + (metrics.cardRowsRemoved ?? 0),
      metrics,
    });
    console.log(
      `precompute_commanders: ${metrics.commanders} commanders rebuilt from ${metrics.decksRead} decks ` +
        `(${metrics.emptied} with none left; ${metrics.cardRowsWritten} card rows written, ${metrics.cardRowsRemoved} removed)`,
    );
  } catch (err) {
    await finishRun(sql, runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  }

  // Their scores, and those of every pair and partner they lend decks to.
  await precomputeScores({ sql, commanderIds: [...new Set(dirty.flatMap((d) => (d.commander_2 === 0 ? [d.commander_1] : [d.commander_1, d.commander_2])))] });
  return { commanders: dirty.length };
}

/**
 * The nightly baseline: card_global_stats and corpus_identity_stats summed from the per-commander stats (every counted
 * deck belongs to exactly one commander key, so the sums are what a full rebuild counts), every commander's shrunk
 * inclusion against the new baseline, then every score. Refuses a corpus that shrank by more than a fifth.
 */
export async function precomputeBaseline(sql: Sql, { force = false }: { force?: boolean } = {}): Promise<'succeeded' | 'failed_sanity'> {
  const start = await startRun(sql, 'precompute_baseline', { uri: BASELINE_URI, updatedAt: new Date().toISOString() }, true);
  if (start.kind === 'skipped') return 'succeeded';
  const runId = start.runId;
  try {
    const [config, catalog, keys, sums] = await Promise.all([
      loadCorpusConfig(sql),
      loadCatalog(sql),
      sql<{ color_identity: number; deck_count: number; deck_months: Record<string, number> }[]>`
        select k.color_identity, s.deck_count, s.deck_months
        from public.commander_stats s
        join public.commander_keys k on k.id = s.commander_key_id
      `,
      sql<{ card_id: number; decks_with: number }[]>`
        select card_id, sum(decks_with)::int as decks_with from public.commander_card_stats group by card_id
      `,
    ]);
    const monthsByIdentity = Array.from({ length: IDENTITIES }, (): Record<string, number> => ({}));
    let eligibleDecks = 0;
    for (const k of keys) {
      eligibleDecks += k.deck_count;
      const target = monthsByIdentity[k.color_identity];
      if (!target) continue;
      for (const [month, n] of Object.entries(k.deck_months)) target[month] = (target[month] ?? 0) + n;
    }
    const globalRows = globalStatRows(new Map(sums.map((r) => [r.card_id, r.decks_with])), monthsByIdentity, catalog);
    const metrics: SyncMetrics = { eligibleDecks, cardsWithStats: globalRows.length };

    const previousDecks = start.previousMetrics?.eligibleDecks;
    const shrank = previousDecks !== undefined && previousDecks > 0 && eligibleDecks < previousDecks * MIN_DECK_SHARE;
    if (eligibleDecks === 0 || (!force && shrank)) {
      const error = `sanity gate: ${eligibleDecks} decks (previous ${previousDecks ?? 'none'})`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: 0, metrics, error });
      console.error(`precompute_baseline: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
      process.exitCode = 1;
      return 'failed_sanity';
    }

    const db = await sql.reserve();
    try {
      await db`begin`;
      try {
        await mergeBaseline(db, globalRows, monthsByIdentity);
        const [reshrunk] = await db<{ n: number }[]>`
          with fresh as (
            select cc.commander_key_id, cc.card_id, g.rate::double precision as p0,
                   (cc.decks_with + ${config.shrinkAlpha}::double precision * g.rate)
                     / (coalesce(cc.eligible_decks, s.deck_count) + ${config.shrinkAlpha}::double precision) as shrunk
            from public.commander_card_stats cc
            join public.card_global_stats g on g.card_id = cc.card_id
            join public.commander_stats s on s.commander_key_id = cc.commander_key_id
          ),
          changed as (
            update public.commander_card_stats cc
            set inclusion_shrunk = f.shrunk, synergy = f.shrunk - f.p0
            from fresh f
            where f.commander_key_id = cc.commander_key_id and f.card_id = cc.card_id
              and (abs(cc.inclusion_shrunk - f.shrunk) >= ${SHRINK_TOLERANCE} or abs(cc.synergy - (f.shrunk - f.p0)) >= ${SHRINK_TOLERANCE})
            returning 1
          )
          select count(*)::int as n from changed
        `;
        metrics.cardRowsReshrunk = reshrunk?.n ?? 0;
        await db`commit`;
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
    }
    await finishRun(sql, runId, 'succeeded', { rowsRead: sums.length, rowsChanged: metrics.cardRowsReshrunk ?? 0, metrics });
    console.log(`precompute_baseline: baselines for ${globalRows.length} cards over ${eligibleDecks} decks; ${metrics.cardRowsReshrunk} commander-card rows re-shrunk`);
  } catch (err) {
    await finishRun(sql, runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  }
  const scores = await precomputeScores({ sql, force });
  return scores.status;
}
