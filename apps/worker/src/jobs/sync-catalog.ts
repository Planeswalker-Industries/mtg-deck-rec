import { downloadBulk, getBulkIndex } from '../lib/bulk';
import { connect, reserve } from '../lib/db';
import { readJsonl, type JsonlStats } from '../lib/jsonl';
import { CARD_COLUMNS, toCardRows, type CardNameRow, type CardRow, type ScryfallCard } from '../lib/scryfall-card';
import { finishRun, heartbeat, startRun } from '../lib/sync-runs';

const BATCH_SIZE = 1000;
const HEARTBEAT_EVERY = 10_000;
/** A card count moving more than this between runs means a bad file, not a new set. */
const MAX_COUNT_DRIFT = 0.05;
const MAX_PARSE_ERROR_RATE = 0.001;

/**
 * Oracle Cards → public.cards + public.card_names.
 *
 * Failure model: rows are staged into session temp tables on one reserved connection, checked against a
 * sanity gate, then merged in a single transaction. If the process dies mid-stream (say at 60%), the temp
 * tables vanish with the connection, live tables are untouched, and the stale 'running' row is marked
 * abandoned by the next run.
 */
export async function syncCatalog({ force = false }: { force?: boolean } = {}): Promise<void> {
  const index = await getBulkIndex();
  const entry = index.find((e) => e.type === 'oracle_cards');
  if (!entry) throw new Error('oracle_cards is missing from the Scryfall bulk index');

  const sql = connect();
  let runId: number | null = null;
  const stats: JsonlStats = { lines: 0, parseErrors: 0 };

  try {
    const start = await startRun(sql, 'scryfall_catalog', { uri: entry.jsonl_download_uri, updatedAt: entry.updated_at }, force);
    if (start.kind === 'skipped') {
      console.log(`scryfall_catalog: unchanged since the last successful run (${entry.updated_at}). Use --force to re-run.`);
      return;
    }
    runId = start.runId;
    const { filePath } = await downloadBulk(entry);

    const db = await reserve(sql);
    try {
      await db`
        create temp table stg_cards (
          oracle_id uuid primary key,
          name text not null,
          name_normalized text not null,
          slug text not null,
          layout text not null,
          mana_value real not null,
          mana_cost text not null,
          type_line text not null,
          oracle_text text,
          card_faces jsonb,
          color_identity smallint not null,
          is_basic_land boolean not null,
          can_be_commander boolean not null,
          partner_kind text,
          partner_qualifier text,
          copy_limit smallint,
          legal_commander text not null,
          legalities jsonb not null,
          game_changer boolean not null,
          is_digital_only boolean not null,
          released_at date,
          images jsonb,
          artist text,
          keywords text[] not null default '{}',
          power text,
          toughness text,
          loyalty text,
          defense text,
          colors smallint,
          color_indicator smallint,
          produced_mana text[],
          fetchable_mana text[],
          fetchable_basic_only boolean not null default false,
          reserved boolean not null,
          scryfall_uri text not null,
          reference_price_usd numeric(10, 2),
          reference_price_finish text,
          prices_as_of timestamptz,
          content_hash bytea not null,
          rules_hash bytea not null
        )
      `;
      await db`create temp table stg_card_names (oracle_id uuid not null, name_normalized text not null, kind text not null)`;

      let cards: CardRow[] = [];
      let names: CardNameRow[] = [];
      let nonDeckCards = 0;
      const flush = async () => {
        if (cards.length > 0) await db`insert into stg_cards ${db(cards, ...CARD_COLUMNS)} on conflict (oracle_id) do nothing`;
        if (names.length > 0) await db`insert into stg_card_names ${db(names, 'oracle_id', 'name_normalized', 'kind')}`;
        cards = [];
        names = [];
      };

      for await (const raw of readJsonl<ScryfallCard>(filePath, stats)) {
        const rows = toCardRows(raw, entry.updated_at);
        if (!rows) {
          nonDeckCards++;
        } else {
          cards.push(rows.card);
          names.push(...rows.names);
          if (cards.length >= BATCH_SIZE) await flush();
        }
        if (stats.lines % HEARTBEAT_EVERY === 0) await heartbeat(sql, runId, stats.lines);
      }
      await flush();

      const [staged] = await db<{ cards: number; names: number }[]>`
        select (select count(*)::int from stg_cards) as cards, (select count(*)::int from stg_card_names) as names
      `;
      const stagedCards = staged?.cards ?? 0;
      const errorRate = stats.lines > 0 ? stats.parseErrors / stats.lines : 1;
      const previous = start.previousMetrics?.cards;
      const drift = previous ? Math.abs(stagedCards - previous) / previous : 0;
      const metrics = { cards: stagedCards, names: staged?.names ?? 0, nonDeckCards, parseErrors: stats.parseErrors };

      if (!force && (stagedCards === 0 || errorRate > MAX_PARSE_ERROR_RATE || drift > MAX_COUNT_DRIFT)) {
        const error = `sanity gate: ${stagedCards} cards (previous ${previous ?? 'none'}, drift ${(drift * 100).toFixed(1)}%), parse error rate ${(errorRate * 100).toFixed(3)}%`;
        await finishRun(sql, runId, 'failed_sanity', { rowsRead: stats.lines, metrics, error });
        console.error(`scryfall_catalog: ${error}. Live tables unchanged; re-run with --force if this is expected.`);
        process.exitCode = 1;
        return;
      }

      // Slugs must be unique: suffix duplicates within the file, and new names that collide with another card's slug.
      await db`
        update stg_cards s
        set slug = s.slug || '-' || left(s.oracle_id::text, 8)
        where s.slug in (select slug from stg_cards group by slug having count(*) > 1)
           or exists (select 1 from public.cards c where c.slug = s.slug and c.oracle_id <> s.oracle_id)
      `;

      await db`begin`;
      try {
        // Update what changed, then insert what is new. Never `insert … on conflict do update`: Postgres draws a
        // sequence value for every row it tries to insert, conflict or not, so that burned one id per card on every run
        // (75 runs took cards_id_seq past 2.6 M for 35 K cards, and past what keyPairs could pack).
        const [updated] = await db<{ n: number }[]>`
          with changed as (
            update public.cards c set
              name = s.name,
              name_normalized = s.name_normalized,
              layout = s.layout,
              mana_value = s.mana_value,
              mana_cost = s.mana_cost,
              type_line = s.type_line,
              oracle_text = s.oracle_text,
              card_faces = s.card_faces,
              color_identity = s.color_identity,
              is_basic_land = s.is_basic_land,
              can_be_commander = s.can_be_commander,
              partner_kind = s.partner_kind,
              partner_qualifier = s.partner_qualifier,
              copy_limit = s.copy_limit,
              legal_commander = s.legal_commander,
              legalities = s.legalities,
              game_changer = s.game_changer,
              is_digital_only = s.is_digital_only,
              released_at = s.released_at,
              images = s.images,
              artist = s.artist,
              keywords = s.keywords,
              power = s.power,
              toughness = s.toughness,
              loyalty = s.loyalty,
              defense = s.defense,
              colors = s.colors,
              color_indicator = s.color_indicator,
              produced_mana = s.produced_mana,
              fetchable_mana = s.fetchable_mana,
              fetchable_basic_only = s.fetchable_basic_only,
              reserved = s.reserved,
              scryfall_uri = s.scryfall_uri,
              content_hash = s.content_hash,
              rules_hash = s.rules_hash,
              updated_at = now(),
              deleted_at = null
            from stg_cards s
            where s.oracle_id = c.oracle_id
              and (c.content_hash is distinct from s.content_hash
                or c.rules_hash is distinct from s.rules_hash
                -- Derived from the card, not hashed: a change to the commander rule rewrites only the rows it moves.
                or c.can_be_commander is distinct from s.can_be_commander
                or c.deleted_at is not null)
            returning 1
          )
          select count(*)::int as n from changed
        `;
        const [inserted] = await db<{ n: number }[]>`
          with added as (
            -- The alias keeps postgres.js reading the column list as identifiers: right after "insert into x (" it
            -- builds rows from the array instead.
            insert into public.cards as t (${db(CARD_COLUMNS)})
            select ${db(CARD_COLUMNS)} from stg_cards s
            where not exists (select 1 from public.cards c where c.oracle_id = s.oracle_id)
            returning 1
          )
          select count(*)::int as n from added
        `;
        const changed = (updated?.n ?? 0) + (inserted?.n ?? 0);

        // Prices are checked on every run, independent of card changes. Once sync:printings has computed the cheapest
        // printing (card_stats), that price wins; the representative printing's price only fills in until then. Only
        // changed prices are written, so prices_as_of records when a price last changed; the app shows
        // prices_checked_at() as the as-of date.
        await db`
          update public.cards c
          set reference_price_usd = s.reference_price_usd,
              reference_price_finish = s.reference_price_finish,
              prices_as_of = s.prices_as_of
          from stg_cards s
          where s.oracle_id = c.oracle_id
            and not exists (select 1 from public.card_stats st where st.card_id = c.id)
            and (
              c.reference_price_usd is distinct from s.reference_price_usd
              or c.reference_price_finish is distinct from s.reference_price_finish
              or c.prices_as_of is null
            )
        `;

        const [removed] = await db<{ n: number }[]>`
          with gone as (
            update public.cards c
            set deleted_at = now()
            where c.deleted_at is null and not exists (select 1 from stg_cards s where s.oracle_id = c.oracle_id)
            returning 1
          )
          select count(*)::int as n from gone
        `;

        // Flavor-name aliases belong to sync:printings; this job owns every other alias kind. Only aliases that appear or
        // disappear are written.
        await db`
          create temp table stg_card_names_resolved as
          select distinct c.id as card_id, n.name_normalized, n.kind
          from stg_card_names n
          join public.cards c on c.oracle_id = n.oracle_id
        `;
        await db`
          delete from public.card_names n
          where n.kind <> 'flavor'
            and not exists (
              select 1 from stg_card_names_resolved s
              where s.card_id = n.card_id and s.name_normalized = n.name_normalized and s.kind = n.kind
            )
        `;
        await db`
          insert into public.card_names (card_id, name_normalized, kind)
          select card_id, name_normalized, kind from stg_card_names_resolved
          on conflict do nothing
        `;

        // Functional twins: rules-identical cards with different names link to the first-printed member.
        // First printing comes from card_stats (sync:printings); until that exists, the representative release date.
        await db`
          with groups as (
            select
              c.rules_hash,
              (array_agg(c.id order by coalesce(st.first_printed_at, c.released_at) nulls last, c.id))[1] as base_id
            from public.cards c
            left join public.card_stats st on st.card_id = c.id
            where c.deleted_at is null and c.rules_hash is not null
            group by c.rules_hash
            having count(*) > 1
          )
          update public.cards c
          set equivalence_base_id = g.base_id
          from groups g
          where c.rules_hash = g.rules_hash
            and c.deleted_at is null
            and c.equivalence_base_id is distinct from g.base_id
        `;
        await db`
          update public.cards c
          set equivalence_base_id = null
          where c.equivalence_base_id is not null
            and (
              c.deleted_at is not null
              or not exists (
                select 1 from public.cards o
                where o.rules_hash = c.rules_hash and o.id <> c.id and o.deleted_at is null
              )
            )
        `;
        const [twins] = await db<{ groups: number; cards: number }[]>`
          select count(distinct equivalence_base_id)::int as groups, count(*)::int as cards
          from public.cards
          where equivalence_base_id is not null and deleted_at is null
        `;
        await db`commit`;

        const result = {
          ...metrics,
          changed,
          removed: removed?.n ?? 0,
          twinGroups: twins?.groups ?? 0,
          twinCards: twins?.cards ?? 0,
        };
        await finishRun(sql, runId, 'succeeded', { rowsRead: stats.lines, rowsChanged: result.changed, metrics: result });
        console.log(
          `scryfall_catalog: ${result.cards} cards (${result.changed} new or changed, ${result.removed} removed), ${result.names} name aliases, ${result.twinGroups} twin groups (${result.twinCards} cards), ${nonDeckCards} non-deck entries skipped`,
        );
      } catch (err) {
        await db`rollback`;
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
