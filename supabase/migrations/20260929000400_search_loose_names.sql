-- Card-name searches ignore punctuation: "garruk veiled" finds Garruk, Veiled Butcher and "high society" finds
-- High-Society Hunter. Both searches also match on card_names.name_loose (the name with everything but letters and
-- digits taken out, which decklist matching already uses), from three letters up, where a trigram index serves it.
--
-- The search index does the same through its `token_separators`; these are the Postgres side, and the only side for a
-- search limited to a collection.
create index if not exists card_names_loose_trgm on public.card_names using gin (name_loose extensions.gin_trgm_ops);

create or replace function public.search_cards(p_query text, p_commander_only boolean default false, p_limit integer default 8)
returns table (card_id integer)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select
      p_query as raw,
      replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') as pattern,
      regexp_replace(p_query, '[^a-z0-9]+', '', 'g') as loose
  ),
  matches as (
    select
      cn.card_id,
      bool_or(cn.name_normalized like q.pattern || '%' or cn.name_loose like q.loose || '%') as prefix,
      bool_or(cn.name_normalized like '%' || q.pattern || '%' or cn.name_loose like '%' || q.loose || '%') as contains,
      max(greatest(extensions.similarity(cn.name_normalized, q.raw), extensions.word_similarity(q.raw, cn.name_normalized))) as score
    from q
    join public.card_names cn
      on cn.name_normalized like q.pattern || '%'
      -- Two letters match too much of the catalog to look inside names cheaply, so they only match name starts.
      or (
        length(q.raw) >= 3
        and (
          cn.name_normalized like '%' || q.pattern || '%'
          or cn.name_normalized operator(extensions.%) q.raw
          or q.raw operator(extensions.<%) cn.name_normalized
        )
      )
      or (length(q.loose) >= 3 and cn.name_loose like '%' || q.loose || '%')
    join public.cards c on c.id = cn.card_id and c.deleted_at is null
    where length(q.raw) >= 2
      and (not p_commander_only or (c.can_be_commander and c.legal_commander = 'legal'))
    group by cn.card_id
  )
  select m.card_id
  from matches m
  join public.cards c on c.id = m.card_id
  left join public.commander_keys k on k.commander_1 = c.id and k.commander_2 is null
  left join public.commander_stats s on s.commander_key_id = k.id
  order by
    m.prefix desc,
    m.contains desc,
    case when m.contains then coalesce(s.deck_count, 0) else 0 end desc,
    m.score desc,
    coalesce(s.deck_count, 0) desc,
    c.name
  limit least(greatest(coalesce(p_limit, 8), 1), 20)
$$;

create or replace function public.search_cards_filtered(
  p_query text default '',
  p_identity_mask smallint default 31,
  p_card_types text[] default null,
  p_mana_values integer[] default null,
  p_mana_value_top integer default 7,
  p_limit integer default 24,
  p_offset integer default 0,
  p_commander_only boolean default false,
  p_owned_ids integer[] default null,
  p_sort text default null
)
returns table (card_id integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw text := coalesce(p_query, '');
  pattern text := replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_');
  loose text := regexp_replace(coalesce(p_query, ''), '[^a-z0-9]+', '', 'g');
  lim integer := least(greatest(coalesce(p_limit, 24), 1), 60);
  off integer := greatest(coalesce(p_offset, 0), 0);
  types text[] := coalesce(p_card_types, '{}');
  bars integer[] := coalesce(p_mana_values, '{}');
  commanders boolean := coalesce(p_commander_only, false);
begin
  if length(raw) >= 2 then
    -- A name narrows the catalog to a few hundred cards at most, so the search starts from the names.
    return query
    with named as (
      select cn.card_id, bool_or(cn.name_normalized like pattern || '%' or cn.name_loose like loose || '%') as prefix
      from public.card_names cn
      -- Two letters match too much of the catalog to look inside names cheaply, so they only match name starts.
      where cn.name_normalized like pattern || '%'
         or (length(raw) >= 3 and cn.name_normalized like '%' || pattern || '%')
         -- Punctuation aside: "garruk veiled" is inside "garrukveiledbutcher".
         or (length(loose) >= 3 and cn.name_loose like '%' || loose || '%')
      group by cn.card_id
    )
    select c.id
    from named n
    join public.cards c on c.id = n.card_id
    left join public.card_global_stats g on g.card_id = c.id
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and (c.color_identity & ~p_identity_mask) = 0
      and (cardinality(bars) = 0 or least(floor(c.mana_value), p_mana_value_top)::integer = any(bars))
      and (cardinality(types) = 0 or types <@ public.card_types(c.type_line))
      and (not commanders or c.can_be_commander)
      and (p_owned_ids is null or c.id in (select unnest(p_owned_ids)))
    order by
      case when p_sort = 'name_asc' then c.name end asc,
      case when p_sort = 'name_desc' then c.name end desc,
      n.prefix desc, coalesce(g.rate, 0) desc, c.name
    limit lim offset off;
  else
    return query
    select c.id
    from public.cards c
    left join public.card_global_stats g on g.card_id = c.id
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and (c.color_identity & ~p_identity_mask) = 0
      and (cardinality(bars) = 0 or least(floor(c.mana_value), p_mana_value_top)::integer = any(bars))
      and (cardinality(types) = 0 or types <@ public.card_types(c.type_line))
      and (not commanders or c.can_be_commander)
      and (p_owned_ids is null or c.id in (select unnest(p_owned_ids)))
    order by
      case when p_sort = 'name_asc' then c.name end asc,
      case when p_sort = 'name_desc' then c.name end desc,
      coalesce(g.rate, 0) desc, c.name
    limit lim offset off;
  end if;
end;
$$;
