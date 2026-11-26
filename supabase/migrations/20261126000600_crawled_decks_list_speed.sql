-- /admin/crawls timed out on hosted (57014, 2026-11-25): admin_list_crawled_decks named every crawled deck's
-- commanders and counted them all with a window function before it paged, a walk over every row of crawl.decks
-- (about 470 MB locally) on each visit. It now counts with an index-only read, pages through the fetched_at index,
-- and names the commanders of the page's rows only.
--
-- A commander search finds the matching cards first (public.cards is small) and the decks through a GIN index on
-- each source's commanders. A deck id search is an exact match on the unique index: a deck id is looked up, not
-- browsed. The function's signature and columns stay as 20261005000200_data_layers.sql left them.

create index if not exists decks_commanders on archidekt.decks using gin (commanders);
create index if not exists decks_commanders on moxfield.decks using gin (commanders);

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
  -- Oracle ids of the cards whose name matches the search; the decks led by any of them match.
  v_commanders uuid[];
  v_total bigint;
begin
  perform public.require_platform_admin();

  if v_search is not null then
    select coalesce(array_agg(c.oracle_id), '{}'::uuid[])
      into v_commanders
      from public.cards c
     where c.name ilike '%' || v_search || '%';
  end if;

  select count(*)
    into v_total
    from crawl.decks d
   where (p_source is null or d.source = p_source)
     and (v_search is null or d.source_deck_id = v_search or d.commanders && v_commanders);

  return query
  with page as (
    select d.id, d.source, d.source_deck_id, d.commanders, d.deck_size, d.listed_updated_at, d.last_updated_at,
           d.fetched_at, d.content_hash, cardinality(d.card_oracle_ids) as distinct_cards
      from crawl.decks d
     where (p_source is null or d.source = p_source)
       and (v_search is null or d.source_deck_id = v_search or d.commanders && v_commanders)
     order by d.fetched_at desc, d.id desc
    offset v_offset
     limit v_limit
  )
  select
    p.id, p.source, p.source_deck_id,
    coalesce(
      (select array_agg(c.name order by c.name) from public.cards c where c.oracle_id = any (p.commanders)),
      '{}'::text[]
    ) as commander_names,
    p.deck_size, p.distinct_cards, p.listed_updated_at, p.last_updated_at, p.fetched_at, p.content_hash,
    v_total as total_count
  from page p
  order by p.fetched_at desc, p.id desc;
end;
$$;

revoke execute on function public.admin_list_crawled_decks(text, text, integer, integer) from public, anon;
grant execute on function public.admin_list_crawled_decks(text, text, integer, integer) to authenticated, service_role;
