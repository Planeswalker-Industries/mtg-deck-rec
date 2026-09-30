-- The deckbuilder's search panel (contract v19): a legendary type filter, commanders only (a deck with no commander
-- yet), only cards the player owns, and an alphabetical order either way.
--
-- card_types gains the legendary supertype, as cardTypes in @mtg/core/scoring and the index's `card_types` do.
create or replace function public.card_types(p_type_line text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by n), '{}')
  from unnest(array['legendary', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land']) with ordinality as u(t, n)
  where lower(split_part(split_part(p_type_line, ' // ', 1), '—', 1)) like '%' || t || '%'
$$;

drop function public.search_cards_filtered(text, smallint, text[], integer[], integer, integer, integer);

-- p_owned_ids limits results to a collection's cards (null: no limit). It can hold tens of thousands of ids, so it is
-- matched as a hashed subquery, never `= any(...)`, which would scan the whole array for every card.
-- p_sort is 'name_asc' or 'name_desc'; null keeps the usual order (best match, then most played).
create function public.search_cards_filtered(
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
      select cn.card_id, bool_or(cn.name_normalized like pattern || '%') as prefix
      from public.card_names cn
      -- Two letters match too much of the catalog to look inside names cheaply, so they only match name starts.
      where cn.name_normalized like pattern || '%'
         or (length(raw) >= 3 and cn.name_normalized like '%' || pattern || '%')
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

revoke execute on function public.search_cards_filtered(text, smallint, text[], integer[], integer, integer, integer, boolean, integer[], text) from public;
grant execute on function public.search_cards_filtered(text, smallint, text[], integer[], integer, integer, integer, boolean, integer[], text) to anon, authenticated, service_role;
