import { reserve, type Sql } from '../lib/db';
import { finishRun, startRun, type SyncJob } from '../lib/sync-runs';

/**
 * The two small serving tables (T055), each a diff of one query against what is stored: card_roles from the tag
 * hierarchy, spellbook_combo_pieces from the collated combos. Each part keeps the version of its inputs in
 * precompute_state and does nothing, recording nothing, while they haven't moved.
 */

type Version = Record<string, unknown>;

async function storedVersion(sql: Sql, part: string): Promise<Version | null> {
  const [row] = await sql<{ version: Version }[]>`select version from public.precompute_state where part = ${part}`;
  return row?.version ?? null;
}

async function saveVersion(sql: Sql, part: string, version: Version): Promise<void> {
  await sql`
    insert into public.precompute_state (part, version) values (${part}, ${sql.json(version as never)})
    on conflict (part) do update set version = excluded.version, updated_at = now()
  `;
}

/** jsonb doesn't keep key order, so versions are compared with their keys sorted. */
const sameVersion = (a: Version | null, b: Version) =>
  a !== null && JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))) === JSON.stringify(Object.entries(b).sort(([x], [y]) => x.localeCompare(y)));

/** Runs one diff as a sync run: stage, then delete what went and insert or update what changed, in one transaction. */
async function diffRun(
  sql: Sql,
  job: SyncJob,
  uri: string,
  merge: (db: Awaited<ReturnType<Sql['reserve']>>) => Promise<{ staged: number; written: number; removed: number }>,
): Promise<void> {
  const start = await startRun(sql, job, { uri, updatedAt: new Date().toISOString() }, true);
  if (start.kind === 'skipped') return;
  const db = await reserve(sql);
  let result: { staged: number; written: number; removed: number };
  try {
    await db`begin`;
    try {
      result = await merge(db);
      await db`commit`;
    } catch (err) {
      await db`rollback`.catch(() => {});
      throw err;
    }
  } catch (err) {
    await finishRun(sql, start.runId, 'failed', { rowsRead: 0, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  await finishRun(sql, start.runId, 'succeeded', {
    rowsRead: result.staged,
    rowsChanged: result.written + result.removed,
    metrics: { rows: result.staged, rowsWritten: result.written, rowsRemoved: result.removed },
  });
  console.log(`${job}: ${result.staged} rows (${result.written} written, ${result.removed} removed)`);
}

/** The tracked roles (app_config.deck_role_targets), as tag ids. */
async function roleIds(sql: Sql): Promise<string[]> {
  const [config] = await sql<{ value: { roles?: { tagId?: unknown }[] } }[]>`
    select value from public.app_config where key = 'deck_role_targets'
  `;
  return (config?.value.roles ?? []).flatMap((r) => (typeof r.tagId === 'string' ? [r.tagId] : [])).sort();
}

/**
 * card_roles: which tracked roles each card fills through the tag hierarchy, disabled tags left out (what the retired
 * rec_card_roles answered per request). Rebuilt when the roles, the kill switch or the tags change.
 */
export async function precomputeRoles(sql: Sql, { force = false }: { force?: boolean } = {}): Promise<void> {
  const roles = await roleIds(sql);
  const [inputs] = await sql<{ disabled: string | null; tags_run: string | null }[]>`
    select (select md5(string_agg(id::text, ',' order by id)) from public.tags where disabled or deleted_at is not null) as disabled,
           (select max(id)::text from public.sync_runs where job = 'oracle_tags' and status = 'succeeded') as tags_run
  `;
  const version = { roles, disabled: inputs?.disabled ?? null, tagsRun: inputs?.tags_run ?? null };
  if (!force && sameVersion(await storedVersion(sql, 'roles'), version)) return;

  await diffRun(sql, 'precompute_roles', 'postgres:public.card_tags', async (db) => {
    await db`
      create temp table stg_roles on commit drop as
      select distinct ct.card_id, tc.ancestor_id as role_id
      from public.card_tags ct
      join public.tags t on t.id = ct.tag_id and not t.disabled and t.deleted_at is null
      join public.tag_closure tc on tc.descendant_id = ct.tag_id
      where tc.ancestor_id = any (${roles}::uuid[])
    `;
    const [staged] = await db<{ n: number }[]>`select count(*)::int as n from stg_roles`;
    const [removed] = await db<{ n: number }[]>`
      with gone as (
        delete from public.card_roles r
        where not exists (select 1 from stg_roles s where s.card_id = r.card_id and s.role_id = r.role_id)
        returning 1
      )
      select count(*)::int as n from gone
    `;
    const [written] = await db<{ n: number }[]>`
      with added as (
        insert into public.card_roles (card_id, role_id) select card_id, role_id from stg_roles
        on conflict (card_id, role_id) do nothing
        returning 1
      )
      select count(*)::int as n from added
    `;
    return { staged: staged?.n ?? 0, written: written?.n ?? 0, removed: removed?.n ?? 0 };
  });
  await saveVersion(sql, 'roles', version);
}

/** spellbook_combo_pieces from corpus.spellbook_combos, after each collation of Commander Spellbook. */
export async function precomputeCombos(sql: Sql, { force = false }: { force?: boolean } = {}): Promise<void> {
  const [state] = await sql<{ collated_at: Date | null }[]>`
    select collated_at from corpus.collate_state where source = 'spellbook'
  `;
  if (!state?.collated_at) return;
  const version = { collatedAt: state.collated_at.toISOString() };
  if (!force && sameVersion(await storedVersion(sql, 'combos'), version)) return;

  await diffRun(sql, 'precompute_combos', 'postgres:corpus.spellbook_combos', async (db) => {
    await db`
      create temp table stg_pieces on commit drop as
      select distinct p.card_id, c.variant_id, c.card_ids as pieces, c.commander_card_ids as commander_pieces,
             cardinality(c.template_names)::smallint as template_pieces, c.min_bracket
      from corpus.spellbook_combos c
      cross join lateral unnest(c.card_ids) as p (card_id)
    `;
    const [staged] = await db<{ n: number }[]>`select count(*)::int as n from stg_pieces`;
    const [removed] = await db<{ n: number }[]>`
      with gone as (
        delete from public.spellbook_combo_pieces x
        where not exists (select 1 from stg_pieces s where s.card_id = x.card_id and s.variant_id = x.variant_id)
        returning 1
      )
      select count(*)::int as n from gone
    `;
    const [written] = await db<{ n: number }[]>`
      with changed as (
        insert into public.spellbook_combo_pieces as x (card_id, variant_id, pieces, commander_pieces, template_pieces, min_bracket)
        select card_id, variant_id, pieces, commander_pieces, template_pieces, min_bracket from stg_pieces
        on conflict (card_id, variant_id) do update set
          pieces = excluded.pieces,
          commander_pieces = excluded.commander_pieces,
          template_pieces = excluded.template_pieces,
          min_bracket = excluded.min_bracket
        where (x.pieces, x.commander_pieces, x.template_pieces, x.min_bracket)
          is distinct from (excluded.pieces, excluded.commander_pieces, excluded.template_pieces, excluded.min_bracket)
        returning 1
      )
      select count(*)::int as n from changed
    `;
    return { staged: staged?.n ?? 0, written: written?.n ?? 0, removed: removed?.n ?? 0 };
  });
  await saveVersion(sql, 'combos', version);
}
