-- The deckbuilder's filters take several values (contract v18). Card types narrow: a card must carry every type picked
-- on its front face, so creature and artifact finds artifact creatures. Mana values widen: any bar picked will do.
--
-- Types now match the type line, not the deck-grouping category (card_category): "artifact" alone finds artifact
-- creatures too, which the category files under creature. The search index gained `card_types` for the same reason;
-- this function is still the fallback and has to answer the same way.

-- Every card type on the front face, subtypes ignored, in the same order as cardTypes in @mtg/core/scoring.
create function public.card_types(p_type_line text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by n), '{}')
  from unnest(array['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land']) with ordinality as u(t, n)
  where lower(split_part(split_part(p_type_line, ' // ', 1), '—', 1)) like '%' || t || '%'
$$;

-- The single-value version is only ever called by the web app, which moves to this one in the same change.
drop function public.search_cards_filtered(text, smallint, text, integer, integer, integer, integer);

-- p_mana_values holds curve bars: a card's bar is its mana value floored, and p_mana_value_top collects everything at
-- or above it. An empty or null list is no filter, for types and mana values alike.
create function public.search_cards_filtered(
  p_query text default '',
  p_identity_mask smallint default 31,
  p_card_types text[] default null,
  p_mana_values integer[] default null,
  p_mana_value_top integer default 7,
  p_limit integer default 24,
  p_offset integer default 0
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
    order by n.prefix desc, coalesce(g.rate, 0) desc, c.name
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
    order by coalesce(g.rate, 0) desc, c.name
    limit lim offset off;
  end if;
end;
$$;

revoke execute on function public.search_cards_filtered(text, smallint, text[], integer[], integer, integer, integer) from public;
grant execute on function public.search_cards_filtered(text, smallint, text[], integer[], integer, integer, integer) to anon, authenticated, service_role;
