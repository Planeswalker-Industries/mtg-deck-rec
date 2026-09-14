-- Public card pages and the sitemap.

-- What a card does: its functional tags (depth 0) and their functional ancestors up to two steps. functional_tags
-- isn't readable by API roles, so card pages read it through this function; disabled tags drop out immediately.
create function public.card_functional_tags(p_card_id integer)
returns table (tag_id uuid, slug text, label text, depth smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with direct as (
    select ct.tag_id
    from public.card_tags ct
    join public.functional_tags f on f.tag_id = ct.tag_id
    where ct.card_id = p_card_id
  ),
  reached as (
    select tc.ancestor_id as tag_id, min(tc.depth) as depth
    from direct d
    join public.tag_closure tc on tc.descendant_id = d.tag_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.ancestor_id
    group by tc.ancestor_id
  )
  select t.id, t.slug, t.label, r.depth::smallint
  from reached r
  join public.tags t on t.id = r.tag_id
  order by r.depth, t.label
$$;

-- Commanders whose decks run a card most, as a share of their decks that could have (updated since its release).
create function public.card_top_commanders(p_card_id integer, p_min_decks integer, p_limit integer default 12)
returns table (commander_key_id integer, slug text, commander_1 integer, commander_2 integer, decks_with integer, eligible_decks integer)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.slug, k.commander_1, k.commander_2, s.decks_with, coalesce(s.eligible_decks, st.deck_count) as eligible_decks
  from public.commander_card_stats s
  join public.commander_keys k on k.id = s.commander_key_id
  join public.commander_stats st on st.commander_key_id = k.id
  where s.card_id = p_card_id
    and coalesce(s.eligible_decks, st.deck_count) >= p_min_decks
  order by s.decks_with::real / greatest(coalesce(s.eligible_decks, st.deck_count), 1) desc, s.decks_with desc, k.slug
  limit p_limit
$$;

-- Every indexable page slug in one value, so the sitemap isn't cut off by the API's row limit.
create function public.sitemap_slugs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'cards', (
      select coalesce(jsonb_agg(c.slug order by c.slug), '[]'::jsonb)
      from public.cards c
      where c.deleted_at is null and c.legal_commander <> 'not_legal'
    ),
    'commanders', (
      select coalesce(jsonb_agg(k.slug order by k.slug), '[]'::jsonb)
      from public.commander_keys k
      join public.commander_stats s on s.commander_key_id = k.id
      where s.deck_count > 0
    )
  )
$$;

revoke execute on function public.card_functional_tags(integer) from public;
revoke execute on function public.card_top_commanders(integer, integer, integer) from public;
revoke execute on function public.sitemap_slugs() from public;
grant execute on function public.card_functional_tags(integer) to anon, authenticated, service_role;
grant execute on function public.card_top_commanders(integer, integer, integer) to anon, authenticated, service_role;
grant execute on function public.sitemap_slugs() to anon, authenticated, service_role;
