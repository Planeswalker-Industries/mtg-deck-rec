import { Readable } from 'node:stream';
import { JsonRootStream, spellbookVariant, type SpellbookFeature } from '@mtg/core/parse';
import { connect } from '../lib/db';
import { politeFetch } from '../lib/http';
import { finishRun, heartbeat, startRun, type SyncMetrics } from '../lib/sync-runs';

/**
 * Commander Spellbook's published export of every combo, gzipped (about 29 MB; 680 MB unpacked), rebuilt daily.
 * The bucket serves it with `content-encoding: gzip`, so fetch hands back the JSON already unpacked.
 * backend.commanderspellbook.com, its API, disallows every path in robots.txt; this file is the sanctioned way in.
 */
const EXPORT_URL = 'https://json.commanderspellbook.com/variants.json.gz';

const BATCH_SIZE = 5000; // rows per staging insert; 10 columns stays well under Postgres's 65,535 parameters
const HEARTBEAT_EVERY = 10_000; // combos read between heartbeats (the whole file takes about 10 s to read)
/** A reload must keep at least this share of the previous run's combos, so a truncated export can't wipe them. */
const MIN_COMBO_SHARE = 0.9;
/**
 * More published combos than this share missing an id, a card's oracle id or name means the export changed shape.
 * Values Spellbook adds (a new bracket tag or result status) are not malformed: raw keeps them as published.
 */
const MAX_MALFORMED_SHARE = 0.01;
/** Malformed variant ids logged per run, as a lead for whoever reads the log. */
const MALFORMED_EXAMPLES = 10;

/** One spellbook.combos row. Oracle ids stay text until the merge casts them, since staging takes them as text. */
interface ComboRow {
  variant_id: string;
  card_oracle_ids: string[];
  card_names: string[];
  commander_oracle_ids: string[];
  template_names: string[];
  feature_ids: number[];
  bracket_tag: string;
  mana_value_needed: number;
  edhrec_deck_count: number | null;
  combo_ids: number[];
}

const COMBO_COLUMNS = [
  'variant_id',
  'card_oracle_ids',
  'card_names',
  'commander_oracle_ids',
  'template_names',
  'feature_ids',
  'bracket_tag',
  'mana_value_needed',
  'edhrec_deck_count',
  'combo_ids',
] as const satisfies readonly (keyof ComboRow)[];

/**
 * Commander Spellbook's combo export → spellbook.features, spellbook.combos, as published: oracle ids, Spellbook's
 * feature ids and bracket tags. Resolving them to our cards is the collator's job (T054), so this needs nothing else
 * loaded first. One request a run, skipped when the file is unchanged since the last successful run. Same failure model
 * as the other syncs: stage, sanity-check, merge only the rows that differ in one transaction.
 */
export async function syncSpellbook({ force = false }: { force?: boolean } = {}): Promise<'succeeded' | 'skipped' | 'failed_sanity'> {
  const sql = connect();
  let runId: number | null = null;
  let combosRead = 0;

  try {
    const res = await politeFetch(EXPORT_URL, { accept: 'application/json' });
    if (!res.body) throw new Error(`${EXPORT_URL}: response had no body`);
    // The export's own timestamp is inside the body; the header says the same before anything is downloaded.
    const lastModified = res.headers.get('last-modified');
    const updatedAt = lastModified ? new Date(lastModified).toISOString() : new Date().toISOString();

    const start = await startRun(sql, 'spellbook_combos', { uri: EXPORT_URL, updatedAt }, force);
    if (start.kind === 'skipped') {
      await res.body.cancel();
      console.log(`spellbook_combos: the export is unchanged since the last successful run. Use --force to re-run.`);
      return 'skipped';
    }
    runId = start.runId;

    const combos: ComboRow[] = [];
    const features = new Map<number, SpellbookFeature>();
    const counts = { notPublished: 0, malformed: 0 };
    const malformedExamples: string[] = [];
    let exportVersion = '';

    const stream = new JsonRootStream(['variants']);
    for await (const chunk of Readable.fromWeb(res.body)) {
      for (const event of stream.push(chunk as Uint8Array)) {
        if (event.kind === 'member') {
          if (event.key === 'version' && typeof event.value === 'string') exportVersion = event.value;
          continue;
        }
        if (event.key !== 'variants') continue;
        combosRead++;
        if (combosRead % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, combosRead);

        const parsed = spellbookVariant(event.value);
        if (!parsed.ok) {
          if (parsed.reason === 'not_published') counts.notPublished++;
          else {
            counts.malformed++;
            const id = (event.value as { id?: unknown } | null)?.id;
            if (malformedExamples.length < MALFORMED_EXAMPLES) malformedExamples.push(typeof id === 'string' ? id : '(no id)');
          }
          continue;
        }
        const { combo } = parsed;
        for (const feature of combo.features) features.set(feature.id, feature);
        combos.push({
          variant_id: combo.id,
          card_oracle_ids: combo.cards.map((card) => card.oracleId),
          card_names: combo.cards.map((card) => card.name),
          commander_oracle_ids: combo.cards.filter((card) => card.mustBeCommander).map((card) => card.oracleId),
          template_names: combo.templates,
          feature_ids: combo.features.map((feature) => feature.id).sort((a, b) => a - b),
          bracket_tag: combo.bracketTag,
          mana_value_needed: combo.manaValueNeeded,
          edhrec_deck_count: combo.edhrecDeckCount,
          combo_ids: combo.comboIds,
        });
      }
    }
    stream.end();

    const published = combos.length + counts.malformed;
    const malformedShare = published > 0 ? counts.malformed / published : 1;
    const previousCombos = start.previousMetrics?.combos;
    const metrics: SyncMetrics = { variants: combosRead, combos: combos.length, features: features.size, ...counts };

    if (
      !force &&
      (combos.length === 0 || malformedShare > MAX_MALFORMED_SHARE || (previousCombos && combos.length < previousCombos * MIN_COMBO_SHARE))
    ) {
      const error = `sanity gate: ${combos.length} combos (previous ${previousCombos ?? 'none'}), malformed ${(malformedShare * 100).toFixed(2)}%`;
      await finishRun(sql, runId, 'failed_sanity', { rowsRead: combosRead, metrics, error });
      console.error(`spellbook_combos: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
      process.exitCode = 1;
      return 'failed_sanity';
    }

    let written = { features: 0, featuresRemoved: 0, combos: 0, combosRemoved: 0 };
    const db = await sql.reserve();
    try {
      await db`create temp table stg_features (id integer primary key, name text not null, status text not null)`;
      await db`
        create temp table stg_combos (
          variant_id text primary key,
          card_oracle_ids text[] not null,
          card_names text[] not null,
          commander_oracle_ids text[] not null,
          template_names text[] not null,
          feature_ids integer[] not null,
          bracket_tag text not null,
          mana_value_needed smallint not null,
          edhrec_deck_count integer,
          combo_ids integer[] not null
        )
      `;
      const featureRows = [...features.values()];
      for (let i = 0; i < featureRows.length; i += BATCH_SIZE) {
        await db`insert into stg_features ${db(featureRows.slice(i, i + BATCH_SIZE), 'id', 'name', 'status')}`;
      }
      for (let i = 0; i < combos.length; i += BATCH_SIZE) {
        await db`insert into stg_combos ${db(combos.slice(i, i + BATCH_SIZE), ...COMBO_COLUMNS)}`;
      }
      await heartbeat(sql, runId, combosRead);

      await db`begin`;
      try {
        const [featuresWritten] = await db<{ n: number }[]>`
          with written as (
            insert into spellbook.features as f (id, name, status)
            select id, name, status from stg_features
            on conflict (id) do update set name = excluded.name, status = excluded.status
            where (f.name, f.status) is distinct from (excluded.name, excluded.status)
            returning 1
          )
          select count(*)::int as n from written
        `;
        const [featuresRemoved] = await db<{ n: number }[]>`
          with removed as (
            delete from spellbook.features f where not exists (select 1 from stg_features s where s.id = f.id) returning 1
          )
          select count(*)::int as n from removed
        `;
        const [combosRemoved] = await db<{ n: number }[]>`
          with removed as (
            delete from spellbook.combos c where not exists (select 1 from stg_combos s where s.variant_id = c.variant_id) returning 1
          )
          select count(*)::int as n from removed
        `;
        const [combosWritten] = await db<{ n: number }[]>`
          with written as (
            insert into spellbook.combos as c (
              variant_id, card_oracle_ids, card_names, commander_oracle_ids, template_names, feature_ids, bracket_tag,
              mana_value_needed, edhrec_deck_count, combo_ids
            )
            select variant_id, card_oracle_ids::uuid[], card_names, commander_oracle_ids::uuid[], template_names, feature_ids,
              bracket_tag, mana_value_needed, edhrec_deck_count, combo_ids
            from stg_combos
            on conflict (variant_id) do update set
              card_oracle_ids = excluded.card_oracle_ids,
              card_names = excluded.card_names,
              commander_oracle_ids = excluded.commander_oracle_ids,
              template_names = excluded.template_names,
              feature_ids = excluded.feature_ids,
              bracket_tag = excluded.bracket_tag,
              mana_value_needed = excluded.mana_value_needed,
              edhrec_deck_count = excluded.edhrec_deck_count,
              combo_ids = excluded.combo_ids
            where (c.card_oracle_ids, c.card_names, c.commander_oracle_ids, c.template_names, c.feature_ids, c.bracket_tag,
                   c.mana_value_needed, c.edhrec_deck_count, c.combo_ids)
              is distinct from (excluded.card_oracle_ids, excluded.card_names, excluded.commander_oracle_ids,
                   excluded.template_names, excluded.feature_ids, excluded.bracket_tag, excluded.mana_value_needed,
                   excluded.edhrec_deck_count, excluded.combo_ids)
            returning 1
          )
          select count(*)::int as n from written
        `;
        await db`commit`;
        written = {
          features: featuresWritten?.n ?? 0,
          featuresRemoved: featuresRemoved?.n ?? 0,
          combos: combosWritten?.n ?? 0,
          combosRemoved: combosRemoved?.n ?? 0,
        };
      } catch (err) {
        await db`rollback`.catch(() => {});
        throw err;
      }
    } finally {
      db.release();
    }

    const rowsChanged = written.features + written.featuresRemoved + written.combos + written.combosRemoved;
    await finishRun(sql, runId, 'succeeded', { rowsRead: combosRead, rowsChanged, metrics });
    console.log(
      `spellbook_combos: export ${exportVersion || 'of unknown version'}, ${combosRead} variants → ${combos.length} combos ` +
        `(${written.combos} written, ${written.combosRemoved} removed; ${written.features} results written, ${written.featuresRemoved} removed)`,
    );
    if (counts.notPublished > 0) console.log(`  skipped ${counts.notPublished} variants that are not published combos`);
    if (counts.malformed > 0) console.log(`  skipped ${counts.malformed} malformed combos, e.g.: ${malformedExamples.join(', ')}`);
    return 'succeeded';
  } catch (err) {
    if (runId !== null) {
      await finishRun(sql, runId, 'failed', { rowsRead: combosRead, error: err instanceof Error ? err.message : String(err) }).catch(() => {});
    }
    throw err;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
