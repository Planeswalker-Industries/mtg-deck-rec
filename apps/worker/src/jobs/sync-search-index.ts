import {
  CARDS_COLLECTION,
  COMMANDERS_COLLECTION,
  COMMANDER_CARDS_COLLECTION,
  SCHEMAS,
  TAGS_COLLECTION,
  toCardDocument,
  toCommanderCardDocument,
  toCommanderDocument,
  toTagDocument,
  type CardIndexRow,
  type CollectionName,
  type CommanderCardIndexRow,
  type CommanderIndexRow,
  type SearchClient,
  type TagIndexRow,
} from '@mtg/core/search';
import { connect, type ReservedSql, type Sql } from '../lib/db';
import { requireSearchClient, searchClient } from '../lib/typesense';

/**
 * Drains public.search_index_queue into the search index, and rebuilds it from scratch on request.
 *
 * The queue holds the **stable key** of every document a write touched. This job looks each one up: a row that is
 * still there becomes a document, a row that is gone or soft-deleted has its document removed. That is why the queue
 * carries no "upsert or delete" column — a hard delete, a soft delete and an un-delete all take one path, and a queue
 * row can never disagree with the table it came from.
 *
 * Replay safety: a queue row is deleted only after the import that covered it succeeded, and only if it has not been
 * re-enqueued since it was read. A crashed drain therefore repeats work rather than losing it, and two drains running
 * at once are harmless because every write is an upsert.
 */

/** Documents per import call. Big enough that 35k cards is a handful of requests, small enough to retry cheaply. */
const IMPORT_BATCH = 1_000;
/** Queue rows claimed per pass. */
const DRAIN_BATCH = 5_000;
/** Rows read from Postgres per document batch. */
const READ_BATCH = 2_000;

const REINDEX = '*';

interface Counts {
  written: number;
  removed: number;
}

const empty = (): Counts => ({ written: 0, removed: 0 });
const add = (a: Counts, b: Counts): Counts => ({ written: a.written + b.written, removed: a.removed + b.removed });

/**
 * The functional tag set, without the kill switch, as a temp table.
 *
 * public.functional_tags_all is two closure walks and a distinct; joining it twice per card in a lateral would run
 * that for every one of 34,800 rows. The sync jobs stage in temp tables for the same reason.
 */
async function stageFunctionalTags(sql: ReservedSql): Promise<void> {
  await sql`create temp table if not exists tmp_functional_tags (tag_id uuid primary key) on commit preserve rows`;
  await sql`truncate tmp_functional_tags`;
  await sql`insert into tmp_functional_tags (tag_id) select tag_id from public.functional_tags_all`;
}

/**
 * Everything a card document is built from, in one query.
 *
 * `names` is every alias a decklist or a search box might use. `tag_ids`/`tag_depths` are the functional tags the
 * card reaches, walked up at most two steps and keeping the shallowest depth each ancestor was reached at — the same
 * walk `cards_functional_tags` does, minus its kill-switch filter, which the app applies as it reads.
 */
async function readCardRows(sql: ReservedSql, ids: readonly number[] | null): Promise<CardIndexRow[]> {
  return sql<CardIndexRow[]>`
    select
      c.id, c.oracle_id, c.name, c.name_normalized, c.slug, c.type_line, c.mana_value, c.color_identity, c.keywords,
      c.game_changer, c.is_basic_land, c.legal_commander, c.can_be_commander, c.partner_kind, c.partner_qualifier,
      c.copy_limit, c.artist, c.images, c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of,
      st.first_printed_at, st.staple_score,
      gs.decks_with as baseline_decks_with, gs.eligible_decks as baseline_eligible_decks, gs.rate as baseline_rate,
      cs.deck_count as commander_deck_count,
      n.names, t.tag_ids, t.tag_depths
    from public.cards c
    left join public.card_stats st on st.card_id = c.id
    left join public.card_global_stats gs on gs.card_id = c.id
    left join public.commander_keys k on k.commander_1 = c.id and k.commander_2 is null
    left join public.commander_stats cs on cs.commander_key_id = k.id
    left join lateral (
      select array_agg(distinct cn.name_normalized) as names
      from public.card_names cn
      where cn.card_id = c.id
    ) n on true
    left join lateral (
      select
        array_agg(r.tag_id::text order by r.depth, r.tag_id) as tag_ids,
        array_agg(r.depth order by r.depth, r.tag_id) as tag_depths
      from (
        select tc.ancestor_id as tag_id, min(tc.depth)::int as depth
        from public.card_tags ct
        join tmp_functional_tags direct on direct.tag_id = ct.tag_id
        join public.tag_closure tc on tc.descendant_id = ct.tag_id and tc.depth <= 2
        join tmp_functional_tags reached on reached.tag_id = tc.ancestor_id
        where ct.card_id = c.id
        group by tc.ancestor_id
      ) r
    ) t on true
    where c.deleted_at is null
      ${ids === null ? sql`` : sql`and c.id = any(${ids as number[]})`}
  `;
}

async function readTagRows(sql: ReservedSql, ids: readonly string[] | null): Promise<TagIndexRow[]> {
  return sql<TagIndexRow[]>`
    select t.id, t.slug, t.label, t.idf, t.disabled
    from public.tags t
    where t.deleted_at is null
      ${ids === null ? sql`` : sql`and t.id = any(${ids as string[]}::uuid[])`}
  `;
}

async function readCommanderRows(sql: ReservedSql, ids: readonly number[] | null): Promise<CommanderIndexRow[]> {
  return sql<CommanderIndexRow[]>`
    select
      k.id, k.slug, k.commander_1, k.commander_2, k.color_identity, s.deck_count,
      array_remove(array[c1.name, c2.name], null) as names
    from public.commander_keys k
    join public.cards c1 on c1.id = k.commander_1
    left join public.cards c2 on c2.id = k.commander_2
    left join public.commander_stats s on s.commander_key_id = k.id
    where true
      ${ids === null ? sql`` : sql`and k.id = any(${ids as number[]})`}
  `;
}

async function readCommanderCardRows(sql: ReservedSql, pairs: readonly [number, number][] | null): Promise<CommanderCardIndexRow[]> {
  return sql<CommanderCardIndexRow[]>`
    select ccs.commander_key_id, ccs.card_id, ccs.decks_with, ccs.inclusion_shrunk, ccs.synergy,
           c.color_identity, c.game_changer
    from public.commander_card_stats ccs
    join public.cards c on c.id = ccs.card_id and c.deleted_at is null
    where true
      ${
        pairs === null
          ? sql``
          : sql`and (ccs.commander_key_id, ccs.card_id) in ${sql(pairs.map(([key, card]) => [key, card]))}`
      }
  `;
}

async function importAll(index: SearchClient, collection: string, documents: Record<string, unknown>[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < documents.length; i += IMPORT_BATCH) {
    const batch = documents.slice(i, i + IMPORT_BATCH);
    const result = await index.importDocuments(collection, batch);
    if (result.failures.length > 0) {
      throw new Error(`${collection}: ${result.failures.length} of ${batch.length} documents were rejected. First: ${result.failures[0]?.error}`);
    }
    written += result.imported;
  }
  return written;
}

/** Writes the documents that still exist and removes the ones that don't. */
async function writeCollection(
  sql: ReservedSql,
  index: SearchClient,
  collection: CollectionName,
  keys: readonly string[],
  now: number,
): Promise<Counts> {
  const counts = empty();
  const found = new Set<string>();
  const documents: Record<string, unknown>[] = [];

  if (collection === CARDS_COLLECTION) {
    for (const row of await readCardRows(sql, keys.map(Number))) {
      found.add(String(row.id));
      documents.push(toCardDocument(row, now) as unknown as Record<string, unknown>);
    }
  } else if (collection === TAGS_COLLECTION) {
    for (const row of await readTagRows(sql, keys)) {
      found.add(row.id);
      documents.push(toTagDocument(row, now) as unknown as Record<string, unknown>);
    }
  } else if (collection === COMMANDERS_COLLECTION) {
    for (const row of await readCommanderRows(sql, keys.map(Number))) {
      found.add(String(row.id));
      documents.push(toCommanderDocument(row, now) as unknown as Record<string, unknown>);
    }
  } else {
    const pairs = keys.flatMap((key): [number, number][] => {
      const [left, right] = key.split(':');
      return left && right ? [[Number(left), Number(right)]] : [];
    });
    for (const row of await readCommanderCardRows(sql, pairs)) {
      found.add(`${row.commander_key_id}:${row.card_id}`);
      documents.push(toCommanderCardDocument(row, now) as unknown as Record<string, unknown>);
    }
  }

  counts.written = await importAll(index, collection, documents);

  // A key with no row behind it is a card the catalog dropped, a soft delete, or a stat that stopped applying.
  for (const key of keys) {
    if (found.has(key)) continue;
    if (await index.deleteDocument(collection, key)) counts.removed += 1;
  }
  return counts;
}

/**
 * Rebuilds a whole collection in place. Used for the '*' sentinel; --rebuild goes through a versioned collection.
 *
 * Every row is read into memory before importing: about 50 MB for the 34,800 cards, which is fine on a worker and
 * simpler than streaming. `commander_cards` is the collection that grows with the corpus, so if it ever reaches
 * millions of rows, read it with a cursor (`sql.cursor(n)`) rather than raising the worker's memory.
 */
async function reindexCollection(sql: ReservedSql, index: SearchClient, collection: CollectionName, target: string, now: number): Promise<Counts> {
  const counts = empty();
  if (collection === CARDS_COLLECTION) {
    counts.written = await importAll(index, target, (await readCardRows(sql, null)).map((r) => toCardDocument(r, now) as unknown as Record<string, unknown>));
  } else if (collection === TAGS_COLLECTION) {
    counts.written = await importAll(index, target, (await readTagRows(sql, null)).map((r) => toTagDocument(r, now) as unknown as Record<string, unknown>));
  } else if (collection === COMMANDERS_COLLECTION) {
    counts.written = await importAll(index, target, (await readCommanderRows(sql, null)).map((r) => toCommanderDocument(r, now) as unknown as Record<string, unknown>));
  } else {
    counts.written = await importAll(
      index,
      target,
      (await readCommanderCardRows(sql, null)).map((r) => toCommanderCardDocument(r, now) as unknown as Record<string, unknown>),
    );
  }
  return counts;
}

interface QueueRow {
  collection: CollectionName;
  document_id: string;
  /**
   * The queue's counter, as a string — the driver returns bigint that way rather than risk a lossy Number.
   *
   * This is what the delete compares on, and it is a counter rather than the timestamp for a reason worth keeping
   * written down: a timestamptz passed back through the driver arrives as a JS Date, millisecond precision, so it
   * compared as *older* than the microsecond-precision row it came from and the delete matched nothing. The drain
   * then read the same batch forever. A counter crosses that boundary exactly.
   */
  seq: string;
}

/**
 * One pass over the queue. Returns how many rows it cleared, so the caller can keep going until there are none left.
 *
 * Rows are read without locking: the work is idempotent, so two drains at once cost time and nothing else. What does
 * matter is the `enqueued_at <=` guard on the delete — a row re-enqueued while the import was in flight describes a
 * change the import did not see, and must survive to be drained again.
 */
async function drainOnce(sql: ReservedSql, index: SearchClient): Promise<{ read: number; cleared: number; counts: Counts }> {
  const rows = await sql<QueueRow[]>`
    select collection, document_id, seq::text as seq
    from public.search_index_queue
    order by seq
    limit ${DRAIN_BATCH}
  `;
  if (rows.length === 0) return { read: 0, cleared: 0, counts: empty() };

  const now = Date.now();
  let counts = empty();
  let cleared = 0;
  const byCollection = new Map<CollectionName, QueueRow[]>();
  for (const row of rows) byCollection.set(row.collection, [...(byCollection.get(row.collection) ?? []), row]);

  for (const [collection, queued] of byCollection) {
    const sentinel = queued.find((r) => r.document_id === REINDEX);
    if (sentinel) {
      // Something every document in the collection depends on moved, so rebuild it rather than guess which changed.
      console.log(`sync:typesense: reindexing ${collection} (a change affecting every document was queued).`);
      counts = add(counts, await reindexCollection(sql, index, collection, collection, now));
    }
    // The individual keys are processed even after a reindex. A reindex imports every row that still exists, so it
    // cannot know about one that stopped existing — a card deleted in the same batch would keep its document and the
    // queue row that said so would be thrown away. The repeated writes are cheap; a stale document is not.
    const keys = queued.map((r) => r.document_id).filter((id) => id !== REINDEX);
    for (let i = 0; i < keys.length; i += READ_BATCH) {
      counts = add(counts, await writeCollection(sql, index, collection, keys.slice(i, i + READ_BATCH), now));
    }
    const removed = await sql`
      delete from public.search_index_queue q
      using unnest(${queued.map((r) => r.document_id)}::text[], ${queued.map((r) => r.seq)}::bigint[])
        as done (document_id, seq)
      where q.collection = ${collection}
        and q.document_id = done.document_id
        and q.seq <= done.seq
    `;
    cleared += removed.count;
  }
  return { read: rows.length, cleared, counts };
}

/**
 * Drains until the queue is empty.
 *
 * A pass that reads rows but clears none would otherwise read the same rows forever, so it stops and says so. That
 * turns any future mistake in the delete into a visible, bounded failure rather than a loop hammering the index —
 * which is precisely how the timestamp-precision bug in QueueRow showed up.
 */
async function drainUntilEmpty(sql: ReservedSql, index: SearchClient): Promise<{ cleared: number; counts: Counts }> {
  let total = empty();
  let cleared = 0;
  for (;;) {
    const pass = await drainOnce(sql, index);
    if (pass.read === 0) break;
    if (pass.cleared === 0) {
      throw new Error(`${pass.read} queued documents were written but could not be cleared from the queue; stopping rather than repeating them.`);
    }
    cleared += pass.cleared;
    total = add(total, pass.counts);
  }
  return { cleared, counts: total };
}

/**
 * Creates any collection the index hasn't got yet, so a first run needs no manual setup.
 *
 * A name that is only an **alias** counts as present. After a --rebuild the real collections are versioned
 * (`cards_1789…`) and the plain name is an alias pointing at one, so listing collections alone would report `cards`
 * as missing and try to create a collection whose name is already taken by the alias.
 */
async function ensureCollections(index: SearchClient): Promise<void> {
  const existing = new Set((await index.listCollections()).map((c) => c.name));
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    if (existing.has(name) || (await index.resolveAlias(name)) !== null) continue;
    console.log(`sync:typesense: creating collection ${name}.`);
    await index.createCollection(schema);
  }
}

/**
 * Rebuilds every collection into a new versioned one and moves the alias when it is complete, so the site is never
 * reading a half-built index. The old versioned collection is dropped afterwards; a plain collection of the same name
 * (what `ensureCollections` makes on a first run) is dropped too, since the alias takes its place.
 */
async function rebuild(sql: ReservedSql, index: SearchClient): Promise<Counts> {
  const now = Date.now();
  const [highWater] = await sql<{ seq: string }[]>`select coalesce(max(seq), 0)::text as seq from public.search_index_queue`;
  const cutoff = highWater?.seq ?? '0';
  let counts = empty();
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const collection = name as CollectionName;
    const previous = await index.resolveAlias(collection);
    const versioned = `${collection}_${now}`;
    await index.createCollection({ ...schema, name: versioned });
    const written = await reindexCollection(sql, index, collection, versioned, now);

    // A first run finds a plain collection under the name the alias is about to take (ensureCollections made it), and
    // the alias needs that name free. Dropping it has to happen *before* the alias moves, never after: after, the
    // name resolves through the alias and dropping it would delete the collection just built.
    if (!previous && (await index.collectionExists(collection))) await index.dropCollection(collection);
    await index.upsertAlias(collection, versioned);

    // Drop every *other* version, not just the one the alias happened to point at. A rebuild that died between
    // creating a collection and moving the alias, or an alias deleted by hand, otherwise leaves a full copy behind
    // — and Typesense loads every collection it has into memory at startup, so an orphan is paid for forever.
    const versionPattern = new RegExp(`^${collection}_\\d+$`);
    for (const { name: existing } of await index.listCollections()) {
      if (existing !== versioned && versionPattern.test(existing)) {
        console.log(`sync:typesense: dropping the orphaned ${existing}.`);
        await index.dropCollection(existing);
      }
    }
    console.log(`sync:typesense: ${collection} rebuilt as ${versioned} (${written.written} documents).`);
    counts = add(counts, written);
  }
  // Everything queued before the rebuild started is already in it. The counter is read first, for the same reason
  // the drain compares on it: it is the one value that survives the round trip exactly.
  await sql`delete from public.search_index_queue where seq <= ${cutoff}`;
  return counts;
}

export async function syncSearchIndex({ rebuild: doRebuild = false }: { rebuild?: boolean } = {}): Promise<void> {
  const index = searchClient();
  if (!index) {
    // Not an error: a checkout, a fork or a CI run with no index configured is a normal state, and the app reads
    // Postgres in exactly that case. `--rebuild` is a deliberate act, so that one insists.
    if (doRebuild) requireSearchClient();
    console.log('sync:typesense: TYPESENSE_URL and TYPESENSE_ADMIN_KEY are not set, so there is no index to update.');
    return;
  }
  const pool = connect();
  // One reserved connection for the whole job: the staged functional-tag table is a temp table, and a temp table
  // belongs to the session that made it. The sync jobs reserve for the same reason.
  const sql = await pool.reserve();
  try {
    if (!(await index.health())) throw new Error('The search index reports itself unhealthy.');
    await stageFunctionalTags(sql);

    if (doRebuild) {
      const counts = await rebuild(sql, index);
      console.log(`sync:typesense: rebuilt ${counts.written} documents.`);
      return;
    }

    await ensureCollections(index);
    const { cleared, counts } = await drainUntilEmpty(sql, index);
    console.log(
      cleared === 0
        ? 'sync:typesense: nothing queued.'
        : `sync:typesense: ${cleared} queued documents (${counts.written} written, ${counts.removed} removed).`,
    );
  } finally {
    sql.release();
    await pool.end();
  }
}

/**
 * The drain a finished sync calls. Never throws and never fails the sync: the data is already committed, and a stale
 * index only means the app reads it from Postgres until the next drain. Silent when there is no index configured,
 * which is the normal state locally and in CI.
 */
export async function drainSearchIndexQuietly(pool: Sql, job: string): Promise<void> {
  const index = searchClient();
  if (!index) return;
  const sql = await pool.reserve();
  try {
    await stageFunctionalTags(sql);
    await ensureCollections(index);
    const { cleared, counts } = await drainUntilEmpty(sql, index);
    if (cleared > 0) console.log(`${job}: search index updated (${counts.written} written, ${counts.removed} removed).`);
  } catch (err) {
    console.warn(`${job}: updating the search index failed, so it stays behind until the next drain: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    sql.release();
  }
}
