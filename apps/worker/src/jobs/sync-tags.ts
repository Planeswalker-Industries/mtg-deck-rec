import { createHash } from 'node:crypto';
import { downloadBulk, getBulkIndex } from '../lib/bulk';
import { connect } from '../lib/db';
import { readJsonl, type JsonlStats } from '../lib/jsonl';
import { finishRun, heartbeat, startRun } from '../lib/sync-runs';

interface RawTag {
  id: string;
  slug: string;
  label: string;
  description?: string | null;
  parent_ids?: string[];
  child_ids?: string[];
  taggings?: { oracle_id: string; weight: string }[];
}

interface TagRow {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  content_hash: Buffer;
}

interface EdgeRow {
  parent_id: string;
  child_id: string;
}

interface TaggingRow {
  tag_id: string;
  oracle_id: string;
  weight_raw: string;
}

const TAG_BATCH = 1000;
const TAGGING_BATCH = 5000;
const HEARTBEAT_EVERY = 500;
/** Community data: a big drop in tags or taggings is far more likely a broken export than a real change. */
const MIN_TAG_RATIO = 0.9;
const MIN_TAGGING_RATIO = 0.8;

/**
 * Oracle Tags → public.tags, tag_edges, card_tags, tag_closure (+ card_count, idf, card_tag_vectors).
 * Requires the catalog to be synced first (taggings join on cards.oracle_id).
 *
 * Weights in the bulk file are strings. The 2026-09-13 profile found 99.7% "median", 612 "very_strong",
 * 1 "strong", so weight is mapped coarsely and carries little ranking signal.
 * The `disabled` kill switch is keyed by tag UUID and never touched by sync.
 */
export async function syncTags({ force = false }: { force?: boolean } = {}): Promise<void> {
  const index = await getBulkIndex();
  const entry = index.find((e) => e.type === 'oracle_tags');
  if (!entry) throw new Error('oracle_tags is missing from the Scryfall bulk index');

  const sql = connect();
  let runId: number | null = null;
  const stats: JsonlStats = { lines: 0, parseErrors: 0 };

  try {
    const [catalog] = await sql<{ n: number }[]>`select count(*)::int as n from public.cards where deleted_at is null`;
    if (!catalog?.n) throw new Error('The card catalog is empty. Run sync:catalog first.');

    const start = await startRun(sql, 'oracle_tags', { uri: entry.jsonl_download_uri, updatedAt: entry.updated_at }, force);
    if (start.kind === 'skipped') {
      console.log(`oracle_tags: unchanged since the last successful run (${entry.updated_at}). Use --force to re-run.`);
      return;
    }
    runId = start.runId;
    const { filePath } = await downloadBulk(entry);

    const db = await sql.reserve();
    try {
      await db`create temp table stg_tags (id uuid primary key, slug text not null, label text not null, description text, content_hash bytea not null)`;
      await db`create temp table stg_tag_edges (parent_id uuid not null, child_id uuid not null)`;
      await db`create temp table stg_taggings (tag_id uuid not null, oracle_id uuid not null, weight_raw text not null)`;

      let tags: TagRow[] = [];
      let edges: EdgeRow[] = [];
      let taggings: TaggingRow[] = [];
      let taggingCount = 0;
      const flushTags = async () => {
        if (tags.length > 0) await db`insert into stg_tags ${db(tags, 'id', 'slug', 'label', 'description', 'content_hash')} on conflict (id) do nothing`;
        if (edges.length > 0) await db`insert into stg_tag_edges ${db(edges, 'parent_id', 'child_id')}`;
        tags = [];
        edges = [];
      };
      const flushTaggings = async () => {
        if (taggings.length > 0) await db`insert into stg_taggings ${db(taggings, 'tag_id', 'oracle_id', 'weight_raw')}`;
        taggings = [];
      };

      for await (const tag of readJsonl<RawTag>(filePath, stats)) {
        const description = tag.description ?? null;
        tags.push({
          id: tag.id,
          slug: tag.slug,
          label: tag.label,
          description,
          content_hash: createHash('sha1').update(JSON.stringify([tag.slug, tag.label, description])).digest(),
        });
        for (const parent of tag.parent_ids ?? []) edges.push({ parent_id: parent, child_id: tag.id });
        for (const child of tag.child_ids ?? []) edges.push({ parent_id: tag.id, child_id: child });
        for (const t of tag.taggings ?? []) {
          taggings.push({ tag_id: tag.id, oracle_id: t.oracle_id, weight_raw: t.weight });
          taggingCount++;
          if (taggings.length >= TAGGING_BATCH) await flushTaggings();
        }
        if (tags.length >= TAG_BATCH) await flushTags();
        if (stats.lines % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, stats.lines);
      }
      await flushTags();
      await flushTaggings();

      const [staged] = await db<{ tags: number }[]>`select count(*)::int as tags from stg_tags`;
      const stagedTags = staged?.tags ?? 0;
      const prev = start.previousMetrics;
      const tagRatio = prev?.tags ? stagedTags / prev.tags : 1;
      const taggingRatio = prev?.taggings ? taggingCount / prev.taggings : 1;
      const metrics = { tags: stagedTags, taggings: taggingCount, parseErrors: stats.parseErrors };

      if (!force && (stagedTags === 0 || stats.parseErrors > 0 || tagRatio < MIN_TAG_RATIO || taggingRatio < MIN_TAGGING_RATIO)) {
        const error = `sanity gate: ${stagedTags} tags (${(tagRatio * 100).toFixed(1)}% of previous), ${taggingCount} taggings (${(taggingRatio * 100).toFixed(1)}% of previous), ${stats.parseErrors} parse errors`;
        await finishRun(sql, runId, 'failed_sanity', { rowsRead: stats.lines, metrics, error });
        console.error(`oracle_tags: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
        process.exitCode = 1;
        return;
      }

      await db`begin`;
      try {
        const [changed] = await db<{ n: number }[]>`
          with upserted as (
            insert into public.tags as t (id, type, slug, label, description, content_hash)
            select id, 'oracle', slug, label, description, content_hash from stg_tags
            on conflict (id) do update set
              slug = excluded.slug,
              label = excluded.label,
              description = excluded.description,
              content_hash = excluded.content_hash,
              updated_at = now(),
              deleted_at = null
            where t.content_hash is distinct from excluded.content_hash or t.deleted_at is not null
            returning 1
          )
          select count(*)::int as n from upserted
        `;

        await db`
          update public.tags t set deleted_at = now()
          where t.deleted_at is null and not exists (select 1 from stg_tags s where s.id = t.id)
        `;

        await db`delete from public.tag_edges`;
        await db`
          insert into public.tag_edges (parent_id, child_id)
          select distinct e.parent_id, e.child_id
          from stg_tag_edges e
          join public.tags p on p.id = e.parent_id and p.deleted_at is null
          join public.tags c on c.id = e.child_id and c.deleted_at is null
          where e.parent_id <> e.child_id
        `;

        await db`delete from public.card_tags`;
        const [linked] = await db<{ n: number }[]>`
          with inserted as (
            insert into public.card_tags (card_id, tag_id, weight_raw, weight)
            select distinct on (c.id, s.tag_id)
              c.id,
              s.tag_id,
              s.weight_raw,
              case s.weight_raw when 'very_strong' then 1.0 when 'strong' then 0.75 else 0.5 end
            from stg_taggings s
            join public.cards c on c.oracle_id = s.oracle_id and c.deleted_at is null
            join public.tags t on t.id = s.tag_id and t.deleted_at is null
            order by c.id, s.tag_id, s.weight_raw desc
            returning 1
          )
          select count(*)::int as n from inserted
        `;

        await db`select public.rebuild_tag_closure()`;

        // card_count covers the tag and its descendants; idf is ln(N / count) scaled to 0..1.
        await db`
          with counts as (
            select tc.ancestor_id as tag_id, count(distinct ct.card_id)::float8 as n
            from public.card_tags ct
            join public.tag_closure tc on tc.descendant_id = ct.tag_id
            group by tc.ancestor_id
          ),
          total as (
            select greatest(count(*), 2)::float8 as n from public.cards where deleted_at is null
          ),
          per_tag as (
            select tg.id, coalesce(c.n, 0) as n from public.tags tg left join counts c on c.tag_id = tg.id
          )
          update public.tags t
          set card_count = p.n::int,
              idf = case when p.n = 0 then 0 else (ln((select n from total) / p.n) / ln((select n from total)))::real end
          from per_tag p
          where p.id = t.id
        `;
        await db`commit`;

        await db`refresh materialized view concurrently public.card_tag_vectors`;

        const result = { ...metrics, changed: changed?.n ?? 0, cardTags: linked?.n ?? 0 };
        await finishRun(sql, runId, 'succeeded', { rowsRead: stats.lines, rowsChanged: result.changed, metrics: result });
        console.log(
          `oracle_tags: ${result.tags} tags (${result.changed} new or changed), ${result.cardTags} card taggings linked of ${taggingCount} in the file`,
        );
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
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
