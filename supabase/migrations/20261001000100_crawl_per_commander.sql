-- The deck crawl goes commander by commander, most viewed decks first.
--
-- It used to walk Archidekt's site-wide feed newest update first and stop at the first stretch of unchanged decks.
-- Hosted runs 1-5 (2026-09-24 to 2026-10-01) showed that never reached anything: Archidekt bumps updatedAt faster
-- than a 3 s crawl can page, so the feed slid away under every walk and each run collected only decks edited while it
-- ran (the oldest deck any run reached was edited under a minute before it started). About 400 decks a day from
-- whoever happened to be editing, 709 commander sets after five runs, none near minDecks.
--
-- Now each run takes commanders from a queue seeded from EDHREC's commander list, most played first, and lists that
-- commander's decks on Archidekt by views:
--   * A first visit reads the first page only (up to 60 decks). Owner decision 2026-10-01: a small base for every
--     commander first, and later visits grow it.
--   * A revisit walks on until it has found `newDecksPerRevisit` decks that are new or whose cards changed. Decks the
--     corpus holds whose listed update time has not moved are stepped over without a request.
--   * Revisits start only once every commander has had its first visit: the queue hands out never-visited commanders
--     first, then the least recently visited.
--
-- The queue doubles as the verification log the owner asked for: a commander Archidekt has no decks for under its
-- name (or its front face) is left at outcome 'not_found', and one whose listings are all led by other commanders at
-- 'no_led_decks'. See docs/roadmap/deck-crawl.md for the query.

create table corpus.crawl_commanders (
  source text not null check (source in ('moxfield', 'archidekt')),
  commander_card_id integer not null references public.cards (id) on delete cascade,
  -- EDHREC's deck count for the commander, summed over every page it appears on (alone and in pairs). Orders the
  -- first pass: the most played commanders get their decks first.
  seed_decks integer not null default 0,
  -- The name that found decks on the source: the card's name, or its front face when the full name of a two-faced
  -- card found nothing. Null until a visit found listings.
  query_name text,
  -- Null until the first complete visit. A visit cut short (partial) or broken (failed) leaves it as it was, so that
  -- commander comes back first.
  last_visited_at timestamptz,
  last_run_id bigint references corpus.crawl_runs (id) on delete set null,
  outcome text check (outcome in ('done', 'exhausted', 'page_cap', 'partial', 'not_found', 'no_led_decks', 'failed')),
  last_error text,
  -- What the last visit did: decks listed, fetched, written (new or changed), counted (written and led by this
  -- commander), and written but led by another commander.
  listed integer not null default 0,
  fetched integer not null default 0,
  written integer not null default 0,
  counted integer not null default 0,
  wrong_commander integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (source, commander_card_id)
);

comment on table corpus.crawl_commanders is
  'The per-commander crawl queue, and its verification log: outcome not_found / no_led_decks marks commanders the source does not know under that name.';

-- The queue's order: never visited first, most played first, then the least recently visited.
create index crawl_commanders_next
  on corpus.crawl_commanders (source, last_visited_at nulls first, seed_decks desc, commander_card_id);

alter table corpus.crawl_commanders enable row level security;
grant select, insert, update, delete on corpus.crawl_commanders to service_role;

alter table corpus.crawl_runs
  add column if not exists commanders_visited integer not null default 0;

comment on column corpus.crawl_runs.skipped_unchanged is
  'Decks listed that the corpus already holds unchanged: stepped over unfetched when the listed update time has not moved, or fetched and found to have the same cards.';

-- The policy for the per-commander crawl. The old feed walk's budget keys go: the run is bounded by time and by each
-- commander's target now. Six hours a day is the owner's allowance (2026-10-01); the stale-claim window has to
-- outlast a full run, or a second cron could seize a live claim.
update public.app_config
   set value = (value - 'maxDecksPerRun' - 'backfillDecks')
               || '{"runMinutes": 360, "firstVisitPages": 1, "newDecksPerRevisit": 350, "maxPagesPerCommander": 40, "staleClaimSeconds": 28800}'::jsonb,
       updated_at = now()
 where key in ('archidekt', 'moxfield');

-- Archidekt's pace goes from 3 s to 2.5 s plus up to half a second of random extra, so requests do not land on a
-- fixed beat (owner decision 2026-10-01). Not one a second: that drew 429s on 2026-09-14.
update public.app_config
   set value = value || '{"requestIntervalMs": 2500, "requestJitterMs": 500}'::jsonb, updated_at = now()
 where key = 'archidekt';

-- Adds the commanders EDHREC lists and refreshes their deck counts. Diff-only: a count that has not changed is not
-- rewritten. Every run calls it first, so a later EDHREC import reaches the queue without anyone remembering to.
-- Returns how many rows it inserted or changed.
create or replace function public.crawl_seed_commanders(p_source text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with seeds as (
    select c.card_id, sum(e.deck_count)::int as seed_decks
      from public.external_commanders e
      cross join lateral (values (e.commander_1), (e.commander_2)) as c (card_id)
      join public.cards k on k.id = c.card_id and k.deleted_at is null
     where c.card_id is not null
     group by c.card_id
  )
  insert into corpus.crawl_commanders as t (source, commander_card_id, seed_decks)
  select p_source, card_id, seed_decks from seeds
  on conflict (source, commander_card_id) do update
    set seed_decks = excluded.seed_decks, updated_at = now()
    where t.seed_decks is distinct from excluded.seed_decks;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- The next commanders to visit, in queue order, leaving out any this run already tried (so a commander whose visit
-- failed is not handed straight back) and any the source has no decks for. A not_found commander stays out until
-- someone clears its outcome by hand.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'cardId', q.commander_card_id,
           'oracleId', k.oracle_id,
           'name', k.name,
           'queryName', coalesce(q.query_name, ''),
           'visited', q.last_visited_at is not null
         ) order by q.last_visited_at nulls first, q.seed_decks desc, q.commander_card_id), '[]'::jsonb)
    from (
      select t.commander_card_id, t.query_name, t.last_visited_at, t.seed_decks
        from corpus.crawl_commanders t
       where t.source = p_source
         and t.outcome is distinct from 'not_found'
         and t.last_run_id is distinct from p_run_id
       order by t.last_visited_at nulls first, t.seed_decks desc, t.commander_card_id
       limit p_limit
    ) q
    join public.cards k on k.id = q.commander_card_id;
$$;

-- Records one commander's visit. A complete visit stamps last_visited_at; a partial or failed one leaves it, so the
-- commander comes back first next run.
create or replace function public.crawl_finish_commander(p_source text, p_card_id int, p_run_id bigint, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_commanders set
    outcome = p_result->>'outcome',
    last_error = nullif(p_result->>'error', ''),
    query_name = coalesce(nullif(p_result->>'queryName', ''), query_name),
    listed = coalesce((p_result->>'listed')::int, 0),
    fetched = coalesce((p_result->>'fetched')::int, 0),
    written = coalesce((p_result->>'written')::int, 0),
    counted = coalesce((p_result->>'counted')::int, 0),
    wrong_commander = coalesce((p_result->>'wrongCommander')::int, 0),
    last_run_id = p_run_id,
    last_visited_at = case when p_result->>'outcome' in ('partial', 'failed') then last_visited_at else now() end,
    updated_at = now()
  where source = p_source and commander_card_id = p_card_id;
$$;

-- What the corpus holds for the ids one list page showed: the content hash and the update time the list showed when
-- the deck was last written, so a deck whose listed time has not moved is stepped over without a request.
create or replace function public.crawl_deck_versions(p_source text, p_ids text[])
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(source_deck_id,
           jsonb_build_object('hash', content_hash, 'listedUpdatedAt', listed_updated_at)), '{}'::jsonb)
    from corpus.decks
   where source = p_source and source_deck_id = any(p_ids);
$$;

-- Unchanged but for the last condition: a deck whose cards are the same but whose listed update time moved has that
-- time recorded, or every revisit would fetch it again. Still writes only rows that differ.
create or replace function public.crawl_upsert_decks(p_source text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int;
begin
  with incoming as (
    select
      p_source as source,
      row_value->>'source_deck_id' as source_deck_id,
      array(select jsonb_array_elements_text(row_value->'commanders')) as commanders,
      row_value->'cards' as cards,
      (row_value->>'deck_size')::int as deck_size,
      row_value->>'content_hash' as content_hash,
      (row_value->>'listed_updated_at')::timestamptz as listed_updated_at,
      (row_value->>'last_updated_at')::timestamptz as last_updated_at
    from jsonb_array_elements(p_rows) as row_value
  )
  insert into corpus.decks as d
    (source, source_deck_id, commanders, cards, deck_size, content_hash, listed_updated_at, last_updated_at)
  select source, source_deck_id, commanders, cards, deck_size, content_hash, listed_updated_at, last_updated_at
    from incoming
  on conflict (source, source_deck_id) do update set
    commanders = excluded.commanders,
    cards = excluded.cards,
    deck_size = excluded.deck_size,
    content_hash = excluded.content_hash,
    listed_updated_at = excluded.listed_updated_at,
    last_updated_at = excluded.last_updated_at,
    fetched_at = now()
  where d.content_hash is distinct from excluded.content_hash
     or d.listed_updated_at is distinct from excluded.listed_updated_at;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- Unchanged but for the queue's progress at the end. `set search_path` is repeated because create or replace drops
-- it; the grants stay.
create or replace function public.crawl_state(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row corpus.crawl_state;
begin
  insert into corpus.crawl_state (source) values (p_source) on conflict (source) do nothing;
  select * into v_row from corpus.crawl_state where source = p_source;
  return jsonb_build_object(
    'disabled', v_row.disabled,
    'disabledReason', coalesce(v_row.disabled_reason, ''),
    'runningRunId', coalesce(v_row.running_run_id, 0),
    'clientId', coalesce(v_row.client_id, ''),
    'claimedAt', v_row.claimed_at,
    'lastDeckId', coalesce(v_row.last_deck_id, ''),
    'probeOk', v_row.probe_ok_at is not null,
    'deckCount', (select count(*) from corpus.decks where source = p_source),
    'commandersQueued', (select count(*) from corpus.crawl_commanders
                          where source = p_source and last_visited_at is null
                            and outcome is distinct from 'not_found'),
    'commandersVisited', (select count(*) from corpus.crawl_commanders
                           where source = p_source and last_visited_at is not null),
    'commandersNotFound', (select count(*) from corpus.crawl_commanders
                            where source = p_source and outcome in ('not_found', 'no_led_decks'))
  );
end;
$$;

-- Unchanged but for commanders_visited.
create or replace function public.crawl_finish_run(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_runs set
    state = case when p_summary->>'state' in ('queued', 'running', 'succeeded', 'failed')
                 then p_summary->>'state' else 'failed' end,
    finished_at = now(),
    pages_seen = coalesce((p_summary->>'pages_seen')::int, 0),
    decks_listed = coalesce((p_summary->>'decks_listed')::int, 0),
    decks_fetched = coalesce((p_summary->>'decks_fetched')::int, 0),
    decks_written = coalesce((p_summary->>'decks_written')::int, 0),
    skipped_unchanged = coalesce((p_summary->>'skipped_unchanged')::int, 0),
    skipped_unqualified = coalesce((p_summary->>'skipped_unqualified')::int, 0),
    skipped_missing = coalesce((p_summary->>'skipped_missing')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;

-- Only the service key, like every crawl_* function: execute is granted to PUBLIC by default, which would put the
-- private corpus behind an `anon` RPC call.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crawl_seed_commanders(text)',
    'public.crawl_next_commanders(text, bigint, int)',
    'public.crawl_finish_commander(text, int, bigint, jsonb)',
    'public.crawl_deck_versions(text, text[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
