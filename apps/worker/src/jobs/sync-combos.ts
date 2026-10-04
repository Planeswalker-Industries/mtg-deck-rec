import { Readable } from 'node:stream';
import { JsonRootStream, spellbookVariant, type SpellbookFeature } from '@mtg/core/parse';
import { connect, type Sql } from '../lib/db';
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
 * More combos than this naming a card our catalog lacks means the two disagree about something big. Some always miss:
 * Spellbook adds previewed cards as soon as they are announced, and the catalog sync runs once a day.
 */
const MAX_UNRESOLVED_COMBO_RATE = 0.03;
/** Unresolved card names logged per run, as a lead for whoever reads the log. */
const UNRESOLVED_EXAMPLES = 10;

interface ComboRow {
  spellbook_id: string;
  card_ids: number[];
  commander_card_ids: number[];
  template_names: string[];
  feature_ids: number[];
  color_identity: number;
  bracket_tag: string;
  mana_value_needed: number;
  popularity: number | null;
  spellbook_combo_ids: number[];
}

const ascending = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);

/** Scryfall oracle id → our card id and colour identity, for every live card. */
async function loadCards(sql: Sql): Promise<Map<string, { id: number; colorIdentity: number }>> {
  const rows = await sql<{ oracle_id: string; id: number; color_identity: number }[]>`
    select oracle_id::text, id, color_identity from public.cards where deleted_at is null
  `;
  return new Map(rows.map((r) => [r.oracle_id, { id: r.id, colorIdentity: r.color_identity }]));
}

/**
 * Commander Spellbook's combo export → combo_features, combos. One request a run, skipped when the file is unchanged
 * since the last successful run. Same failure model as the other syncs: stage, sanity-check, merge only the rows that
 * differ in one transaction. Run after sync:catalog, so combos with newly printed cards resolve.
 */
export async function syncCombos({ force = false }: { force?: boolean } = {}): Promise<'succeeded' | 'skipped' | 'failed_sanity'> {
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
    const cards = await loadCards(sql);

    const combos: ComboRow[] = [];
    const features = new Map<number, SpellbookFeature>();
    const counts = { notPublished: 0, unresolvedCombos: 0 };
    const unresolvedCards = new Map<string, string>(); // oracle id → name
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

        const combo = spellbookVariant(event.value);
        if (!combo) {
          counts.notPublished++;
          continue;
        }
        const resolved = combo.cards.map((card) => cards.get(card.oracleId));
        if (resolved.some((card) => card === undefined)) {
          counts.unresolvedCombos++;
          combo.cards.forEach((card, i) => resolved[i] === undefined && unresolvedCards.set(card.oracleId, card.name));
          continue;
        }
        const pieces = resolved as { id: number; colorIdentity: number }[];
        for (const feature of combo.features) features.set(feature.id, feature);
        combos.push({
          spellbook_id: combo.id,
          card_ids: ascending(new Set(pieces.map((card) => card.id))),
          commander_card_ids: ascending(new Set(pieces.filter((_, i) => combo.cards[i]?.mustBeCommander).map((card) => card.id))),
          template_names: combo.templates,
          feature_ids: ascending(combo.features.map((feature) => feature.id)),
          color_identity: pieces.reduce((mask, card) => mask | card.colorIdentity, 0),
          bracket_tag: combo.bracketTag,
          mana_value_needed: combo.manaValueNeeded,
          popularity: combo.popularity,
          spellbook_combo_ids: combo.comboIds,
        });
      }
    }
    stream.end();

    const unresolvedRate = combosRead > 0 ? counts.unresolvedCombos / combosRead : 1;
    const previousCombos = start.previousMetrics?.combos;
    const metrics: SyncMetrics = {
      variants: combosRead,
      combos: combos.length,
      features: features.size,
      unresolvedCards: unresolvedCards.size,
      ...counts,
    };

    if (
      !force &&
      (combos.length === 0 || unresolvedRate > MAX_UNRESOLVED_COMBO_RATE || (previousCombos && combos.length < previousCombos * MIN_COMBO_SHARE))
    ) {
      const error = `sanity gate: ${combos.length} combos (previous ${previousCombos ?? 'none'}), unresolved ${(unresolvedRate * 100).toFixed(2)}%`;
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
          spellbook_id text primary key,
          card_ids integer[] not null,
          commander_card_ids integer[] not null,
          template_names text[] not null,
          feature_ids integer[] not null,
          color_identity smallint not null,
          bracket_tag text not null,
          mana_value_needed smallint not null,
          popularity integer,
          spellbook_combo_ids integer[] not null
        )
      `;
      const featureRows = [...features.values()];
      for (let i = 0; i < featureRows.length; i += BATCH_SIZE) {
        await db`insert into stg_features ${db(featureRows.slice(i, i + BATCH_SIZE), 'id', 'name', 'status')}`;
      }
      for (let i = 0; i < combos.length; i += BATCH_SIZE) {
        await db`
          insert into stg_combos ${db(
            combos.slice(i, i + BATCH_SIZE),
            'spellbook_id',
            'card_ids',
            'commander_card_ids',
            'template_names',
            'feature_ids',
            'color_identity',
            'bracket_tag',
            'mana_value_needed',
            'popularity',
            'spellbook_combo_ids',
          )}
        `;
      }
      await heartbeat(sql, runId, combosRead);

      await db`begin`;
      try {
        const [featuresWritten] = await db<{ n: number }[]>`
          with written as (
            insert into public.combo_features as f (id, name, status)
            select id, name, status from stg_features
            on conflict (id) do update set name = excluded.name, status = excluded.status
            where (f.name, f.status) is distinct from (excluded.name, excluded.status)
            returning 1
          )
          select count(*)::int as n from written
        `;
        const [featuresRemoved] = await db<{ n: number }[]>`
          with removed as (
            delete from public.combo_features f where not exists (select 1 from stg_features s where s.id = f.id) returning 1
          )
          select count(*)::int as n from removed
        `;
        const [combosRemoved] = await db<{ n: number }[]>`
          with removed as (
            delete from public.combos c where not exists (select 1 from stg_combos s where s.spellbook_id = c.spellbook_id) returning 1
          )
          select count(*)::int as n from removed
        `;
        const [combosWritten] = await db<{ n: number }[]>`
          with written as (
            insert into public.combos as c (
              spellbook_id, card_ids, commander_card_ids, template_names, feature_ids, color_identity, bracket_tag,
              mana_value_needed, popularity, spellbook_combo_ids
            )
            select spellbook_id, card_ids, commander_card_ids, template_names, feature_ids, color_identity, bracket_tag,
              mana_value_needed, popularity, spellbook_combo_ids
            from stg_combos
            on conflict (spellbook_id) do update set
              card_ids = excluded.card_ids,
              commander_card_ids = excluded.commander_card_ids,
              template_names = excluded.template_names,
              feature_ids = excluded.feature_ids,
              color_identity = excluded.color_identity,
              bracket_tag = excluded.bracket_tag,
              mana_value_needed = excluded.mana_value_needed,
              popularity = excluded.popularity,
              spellbook_combo_ids = excluded.spellbook_combo_ids
            where (c.card_ids, c.commander_card_ids, c.template_names, c.feature_ids, c.color_identity, c.bracket_tag,
                   c.mana_value_needed, c.popularity, c.spellbook_combo_ids)
              is distinct from (excluded.card_ids, excluded.commander_card_ids, excluded.template_names, excluded.feature_ids,
                   excluded.color_identity, excluded.bracket_tag, excluded.mana_value_needed, excluded.popularity,
                   excluded.spellbook_combo_ids)
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
      `spellbook_combos: export ${exportVersion || 'of unknown version'}, ${combosRead} combos → ${combos.length} stored ` +
        `(${written.combos} written, ${written.combosRemoved} removed; ${written.features} results written, ${written.featuresRemoved} removed)`,
    );
    if (counts.notPublished > 0) console.log(`  skipped ${counts.notPublished} entries that are not published combos`);
    if (counts.unresolvedCombos > 0) {
      const examples = [...unresolvedCards.values()].slice(0, UNRESOLVED_EXAMPLES).join('; ');
      console.log(`  skipped ${counts.unresolvedCombos} combos naming ${unresolvedCards.size} cards the catalog lacks, e.g.: ${examples}`);
    }
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
