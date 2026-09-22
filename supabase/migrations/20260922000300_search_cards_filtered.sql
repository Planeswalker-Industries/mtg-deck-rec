-- Card search for the deckbuilder: an optional name, narrowed to a commander's colours, a card type and a mana value.
-- With no name it browses: the filtered cards most played across Commander decks come first.
--
-- It stays in Postgres rather than the search index for now: the index has no card-type field, and adding one means a
-- schema change and a full rebuild on the VPS. Plain name search (search_cards) keeps using the index.
--
-- p_category is the deck-grouping category (the same precedence as cardCategory in @mtg/core/scoring: an artifact
-- creature is a creature, an artifact land an artifact). p_mana_value at or above p_mana_value_top means "that or more",
-- matching the last bar of the mana curve. Only cards legal in Commander are returned; basic lands are, since decks run
-- them.

-- Browsing reads every legal card's colours, mana value and type line. Without this it read the cards heap, ~12,700
-- buffers (460 ms cold, ~100 ms warm) for one page of results; with it, an index-only scan of ~430 buffers. Measured
-- locally warm: browsing 55-85 ms (most of it card_category over every legal card), a name 5-13 ms. The index is 2.3 MB.
create index if not exists cards_deckbuilder_browse on public.cards (id)
  include (color_identity, mana_value, name, type_line)
  where deleted_at is null and legal_commander = 'legal';

create function public.card_category(p_type_line text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select t
      from unnest(array['creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land']) with ordinality as u(t, n)
      where lower(split_part(split_part(p_type_line, ' // ', 1), '—', 1)) like '%' || t || '%'
      order by n
      limit 1
    ),
    'artifact'
  )
$$;

create function public.search_cards_filtered(
  p_query text default '',
  p_identity_mask smallint default 31,
  p_category text default null,
  p_mana_value integer default null,
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
      and (p_mana_value is null
        or (p_mana_value >= p_mana_value_top and c.mana_value >= p_mana_value_top)
        or (p_mana_value < p_mana_value_top and floor(c.mana_value) = p_mana_value))
      and (p_category is null or public.card_category(c.type_line) = p_category)
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
      and (p_mana_value is null
        or (p_mana_value >= p_mana_value_top and c.mana_value >= p_mana_value_top)
        or (p_mana_value < p_mana_value_top and floor(c.mana_value) = p_mana_value))
      and (p_category is null or public.card_category(c.type_line) = p_category)
    order by coalesce(g.rate, 0) desc, c.name
    limit lim offset off;
  end if;
end;
$$;

revoke execute on function public.search_cards_filtered(text, smallint, text, integer, integer, integer, integer) from public;
grant execute on function public.search_cards_filtered(text, smallint, text, integer, integer, integer, integer) to anon, authenticated, service_role;
