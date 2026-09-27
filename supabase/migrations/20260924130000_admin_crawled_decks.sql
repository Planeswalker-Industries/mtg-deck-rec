-- Reading the crawled corpus, for platform admins only.
--
-- `corpus` is deliberately off PostgREST's exposed schema list, because it holds third-party decklists. That stays
-- true: nothing here exposes the schema. These are security-definer functions in `public` that read it on behalf of
-- a caller who has already proved they are a platform admin, exactly like the rest of the admin surface, and every
-- one of them opens with require_platform_admin() so a stray grant cannot become a leak.
--
-- Why it exists: the crawl's health was diagnosable only from pg_stat_statements and a container log (see
-- docs/roadmap/deck-crawl.md). Deck counts and run rows say whether it ran; only the cards say whether the adapter
-- parsed what it fetched, which is the failure a crawl cannot detect about itself.

-- One row: where each source is and what it has. Everything the header of an operations page needs, in one call
-- rather than four, because a page that asks four questions shows three of them late.
create function public.admin_crawl_overview()
returns table (
  source text,
  decks bigint,
  last_fetched_at timestamptz,
  disabled boolean,
  disabled_reason text,
  probe_ok_at timestamptz,
  running_run_id bigint,
  claimed_at timestamptz,
  last_run_id bigint,
  last_run_state text,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_run_decks_written integer,
  last_run_error text
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
    s.source,
    coalesce(d.n, 0) as decks,
    d.newest,
    s.disabled,
    s.disabled_reason,
    s.probe_ok_at,
    s.running_run_id,
    s.claimed_at,
    r.id, r.state, r.started_at, r.finished_at, r.decks_written, r.error
  from corpus.crawl_state s
  -- Every inner reference is aliased: the RETURNS TABLE column names (source, decks, ...) are in scope as plpgsql
  -- variables inside the body, so a bare column of the same name is ambiguous and the function will not run.
  left join lateral (
    select count(*) as n, max(dd.fetched_at) as newest
    from corpus.decks dd where dd.source = s.source
  ) d on true
  left join lateral (
    select cr.id, cr.state, cr.started_at, cr.finished_at, cr.decks_written, cr.error
    from corpus.crawl_runs cr where cr.source = s.source order by cr.id desc limit 1
  ) r on true
  order by s.source;
end;
$$;

-- A page of decks, newest fetch first. Commander names are resolved here rather than in the app: the oracle ids a
-- deck stores mean nothing on screen, and joining them per row in the client would be one request per deck.
create function public.admin_list_crawled_decks(
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
          where c.oracle_id::text = any(d.commanders)),
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
  -- Searching a deck id or any of its commanders: the two things someone looking for one deck actually has.
  where v_search is null
     or n.source_deck_id ilike '%' || v_search || '%'
     or exists (select 1 from unnest(n.commander_names) cn where cn ilike '%' || v_search || '%')
  order by n.fetched_at desc, n.id desc
  offset v_offset
  limit v_limit;
end;
$$;

-- One deck's cards, resolved to names. Separate from the list because most rows are never opened, and a hundred
-- card names per deck across a page of twenty-five is the difference between a fast list and a slow one.
--
-- A card the catalog does not know is returned with a null name rather than dropped: the crawl storing an oracle id
-- the catalog has never heard of is itself worth seeing, and silently shortening the list would hide it.
create function public.admin_crawled_deck_cards(p_deck_id bigint)
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
    e.key as oracle_id,
    c.name,
    c.type_line,
    e.value::text::integer as quantity
  from corpus.decks d
  cross join lateral jsonb_each(d.cards) e(key, value)
  left join public.cards c on c.oracle_id::text = e.key and c.deleted_at is null
  where d.id = p_deck_id
  order by c.name nulls last, e.key;
end;
$$;

-- Execute is granted to `authenticated` and the function decides, which is how the rest of the admin surface works:
-- the guard lives in one place (require_platform_admin) rather than in whoever remembered to check.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_crawl_overview()',
    'public.admin_list_crawled_decks(text, text, integer, integer)',
    'public.admin_crawled_deck_cards(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
