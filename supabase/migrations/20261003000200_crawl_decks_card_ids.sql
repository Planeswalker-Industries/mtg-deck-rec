-- Crawled decks are stored by catalog card id, not by Scryfall oracle id.
--
-- corpus.decks kept `commanders` as text[] oracle ids and `cards` as {oracle id: quantity}. Every read had to join
-- `cards` on oracle_id through a text/uuid cast, and casting the indexed side (`cards.oracle_id::text = ...`) hides
-- cards_oracle_id_key: crawl_seed_commanders read the whole cards heap and sorted it to disk on every run. Cold, that
-- outran PostgREST's 8 s statement_timeout, so hosted run 8 (2026-10-03) failed on its first step and the queue was
-- never seeded. card-graph-plan.md always had decks as card ids; this brings the crawl table in line.
--
-- Now `commander_card_ids` is int[] (sorted) and `cards` is {card id: quantity}. The lookup happens once, on write, in
-- crawl_upsert_decks; reads join cards by primary key or not at all (the seed's held count needs no join). The crawler
-- itself is unchanged: it still sends oracle ids, as the source reports them, and still hashes on them, so
-- content_hash and crawl_deck_versions mean what they did.
--
-- A deck naming a card the catalog does not have (a card printed since the last catalog sync) is not stored. It is
-- returned as unresolved, the run counts it in skipped_unresolved, and because nothing is held for it the next visit
-- fetches it again, by which time the daily sync has normally caught up. Storing it without the card would leave a
-- 99-card deck in the corpus for good (owner decision 2026-10-03).
--
-- Resolution matches any cards row with the oracle id, deleted or not: the id is still a card, and leaving out rows
-- the catalog has retired is aggregation's call, as it is for every other filter.

-- === the table ===

alter table corpus.decks add column commander_card_ids integer[];
alter table corpus.decks add column card_ids jsonb;

-- The existing rows, once. Malformed ids cannot be cast, so pg_input_is_valid steps over them: they leave the row
-- unresolved instead of failing the migration.
with resolved as (
  select d.id,
         (select array_agg(k.id order by k.id)
            from unnest(d.commanders) as o (oracle_id)
            join public.cards k
              on k.oracle_id = case when pg_input_is_valid(o.oracle_id, 'uuid') then o.oracle_id::uuid end)
           as commander_card_ids,
         (select jsonb_object_agg(k.id::text, e.value)
            from jsonb_each(d.cards) as e (key, value)
            join public.cards k
              on k.oracle_id = case when pg_input_is_valid(e.key, 'uuid') then e.key::uuid end)
           as card_ids,
         cardinality(d.commanders) as commanders_sent,
         (select count(*) from jsonb_object_keys(d.cards)) as cards_sent
    from corpus.decks d
)
update corpus.decks d
   set commander_card_ids = r.commander_card_ids, card_ids = coalesce(r.card_ids, '{}'::jsonb)
  from resolved r
 where r.id = d.id
   and cardinality(r.commander_card_ids) = r.commanders_sent
   and (select count(*) from jsonb_object_keys(coalesce(r.card_ids, '{}'::jsonb))) = r.cards_sent;

-- A row that did not resolve is dropped, not kept half-converted: nothing is held for it, so the crawl fetches it
-- again on its commander's next visit.
delete from corpus.decks where commander_card_ids is null;

alter table corpus.decks drop column commanders;
alter table corpus.decks drop column cards;
alter table corpus.decks rename column card_ids to cards;
alter table corpus.decks alter column commander_card_ids set not null;
alter table corpus.decks alter column cards set not null;

comment on column corpus.decks.commander_card_ids is
  'The commanders as public.cards ids, sorted: one, or a partner pair. Resolved from the source''s oracle ids on write.';
comment on column corpus.decks.cards is
  'The rest of the deck as {public.cards id: quantity}. Quantities are kept: basics are most of a mana base, and deck_size cannot be re-derived from distinct cards.';

alter table corpus.crawl_runs add column if not exists skipped_unresolved integer not null default 0;

comment on column corpus.crawl_runs.skipped_unresolved is
  'Decks fetched but not stored because they name a card the catalog does not have yet. Refetched on the next visit.';

-- === writing ===

-- The return type changes (a count becomes the count plus the decks that did not resolve), which create or replace
-- cannot do.
drop function public.crawl_upsert_decks(text, jsonb);

-- Writes the decks whose every card resolves, and only rows that differ: a deck whose content hash and listed update
-- time are both unchanged is not rewritten. Returns {"written": n, "unresolved": [{"deckId", "missing": [oracle ids]}]}
-- so the crawl can count and log what it could not store.
create function public.crawl_upsert_decks(p_source text, p_rows jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with incoming as (
    select
      row_value->>'source_deck_id' as source_deck_id,
      array(select jsonb_array_elements_text(row_value->'commanders')) as commanders,
      coalesce(row_value->'cards', '{}'::jsonb) as cards,
      (row_value->>'deck_size')::int as deck_size,
      row_value->>'content_hash' as content_hash,
      (row_value->>'listed_updated_at')::timestamptz as listed_updated_at,
      (row_value->>'last_updated_at')::timestamptz as last_updated_at
    from jsonb_array_elements(p_rows) as row_value
  ),
  resolved as (
    select
      i.source_deck_id, i.deck_size, i.content_hash, i.listed_updated_at, i.last_updated_at,
      (select array_agg(k.id order by k.id)
         from unnest(i.commanders) as o (oracle_id)
         join public.cards k
           on k.oracle_id = case when pg_input_is_valid(o.oracle_id, 'uuid') then o.oracle_id::uuid end)
        as commander_card_ids,
      coalesce(
        (select jsonb_object_agg(k.id::text, e.value)
           from jsonb_each(i.cards) as e (key, value)
           join public.cards k
             on k.oracle_id = case when pg_input_is_valid(e.key, 'uuid') then e.key::uuid end),
        '{}'::jsonb) as cards,
      -- Every oracle id the deck sent that matched no card, commanders and the rest alike: what the log names.
      array(
        select s.oracle_id
          from (select unnest(i.commanders) union all select jsonb_object_keys(i.cards)) as s (oracle_id)
         where not exists (
           select 1 from public.cards k
            where k.oracle_id = case when pg_input_is_valid(s.oracle_id, 'uuid') then s.oracle_id::uuid end)
      ) as missing
    from incoming i
  ),
  written as (
    insert into corpus.decks as d
      (source, source_deck_id, commander_card_ids, cards, deck_size, content_hash, listed_updated_at, last_updated_at)
    select p_source, source_deck_id, commander_card_ids, cards, deck_size, content_hash, listed_updated_at,
           last_updated_at
      from resolved
     where cardinality(missing) = 0
    on conflict (source, source_deck_id) do update set
      commander_card_ids = excluded.commander_card_ids,
      cards = excluded.cards,
      deck_size = excluded.deck_size,
      content_hash = excluded.content_hash,
      listed_updated_at = excluded.listed_updated_at,
      last_updated_at = excluded.last_updated_at,
      fetched_at = now()
    where d.content_hash is distinct from excluded.content_hash
       or d.listed_updated_at is distinct from excluded.listed_updated_at
    returning 1
  )
  select jsonb_build_object(
    'written', (select count(*) from written),
    'unresolved', coalesce(
      (select jsonb_agg(jsonb_build_object('deckId', source_deck_id, 'missing', to_jsonb(missing)))
         from resolved where cardinality(missing) > 0),
      '[]'::jsonb));
$$;

-- Unchanged but for skipped_unresolved.
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
    skipped_unresolved = coalesce((p_summary->>'skipped_unresolved')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;

-- === reading ===

-- Unchanged but for the held count, which now reads the stored card ids and joins nothing.
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
  ),
  held as (
    select c.card_id, count(*)::int as held_decks
      from corpus.decks d
      cross join lateral unnest(d.commander_card_ids) as c (card_id)
     where d.source = p_source
     group by c.card_id
  )
  insert into corpus.crawl_commanders as t (source, commander_card_id, seed_decks, held_decks)
  select p_source, s.card_id, s.seed_decks, coalesce(h.held_decks, 0)
    from seeds s
    left join held h on h.card_id = s.card_id
  on conflict (source, commander_card_id) do update
    set seed_decks = excluded.seed_decks, held_decks = excluded.held_decks, updated_at = now()
    where t.seed_decks is distinct from excluded.seed_decks
       or t.held_decks is distinct from excluded.held_decks;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- Unchanged but for the commander names, now a primary-key lookup.
create or replace function public.admin_list_crawled_decks(
  p_source text default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id bigint,
  source text,
  source_deck_id text,
  commander_names text[],
  deck_size integer,
  distinct_cards integer,
  listed_updated_at timestamptz,
  last_updated_at timestamptz,
  fetched_at timestamptz,
  content_hash text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_platform_admin();

  return query
  with named as (
    select
      d.id, d.source, d.source_deck_id, d.deck_size, d.listed_updated_at, d.last_updated_at, d.fetched_at,
      d.content_hash,
      (select count(*) from jsonb_object_keys(d.cards))::integer as distinct_cards,
      coalesce(
        (select array_agg(c.name order by c.name)
           from public.cards c
          where c.id = any(d.commander_card_ids)),
        '{}'::text[]
      ) as commander_names
    from corpus.decks d
    where (p_source is null or d.source = p_source)
  )
  select
    n.id, n.source, n.source_deck_id, n.commander_names, n.deck_size, n.distinct_cards,
    n.listed_updated_at, n.last_updated_at, n.fetched_at, n.content_hash,
    count(*) over () as total_count
  from named n
  where v_search is null
     or n.source_deck_id ilike '%' || v_search || '%'
     or exists (select 1 from unnest(n.commander_names) cn where cn ilike '%' || v_search || '%')
  order by n.fetched_at desc, n.id desc
  offset v_offset
  limit v_limit;
end;
$$;

-- Same columns as before, so the admin page is unchanged: oracle_id now comes from the catalog row. Every stored
-- card resolved on write, so the left join only guards a card deleted from the catalog outright, which comes back
-- with the stored id in place of its oracle id and a null name.
create or replace function public.admin_crawled_deck_cards(p_deck_id bigint)
returns table (
  oracle_id text,
  name text,
  type_line text,
  quantity integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();

  return query
  select
    coalesce(c.oracle_id::text, e.key) as oracle_id,
    c.name,
    c.type_line,
    e.value::text::integer as quantity
  from corpus.decks d
  cross join lateral jsonb_each(d.cards) e(key, value)
  left join public.cards c on c.id = e.key::integer
  where d.id = p_deck_id
  order by c.name nulls last, e.key;
end;
$$;

-- crawl_upsert_decks was dropped and created, so its grants are new: only the service key, like every crawl_*
-- function (execute is granted to PUBLIC by default, which would put the private corpus behind an `anon` RPC call).
revoke all on function public.crawl_upsert_decks(text, jsonb) from public, anon, authenticated;
grant execute on function public.crawl_upsert_decks(text, jsonb) to service_role;
