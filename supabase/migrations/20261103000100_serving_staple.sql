-- Staple score in Add and Build (T083). Cards no deck of the commander runs all land on the same corpus floor, so an
-- owned Page, Loose Leaf tied an owned Worn Powerstone and won on pool order. serving_cards now hands the app each
-- card's global staple score (card_stats.staple_score, from printings, not the corpus), which Add and Build read as the
-- staple component. Its weight (app_config.scoring weights.add.staple) stays 0 until cli eval:holdout passes it.

alter type public.serving_card add attribute staple_score real;

-- serving_cards: as 20261102000200_card_land_search.sql, with staple_score last (the type's attribute order).
create or replace function public.serving_cards(p_commander_ids integer[], p_card_ids integer[])
returns setof public.serving_card
language sql
stable
security definer
set search_path = ''
set enable_nestloop = on
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  target_set as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           s.commander_1 is not null as known,
           coalesce(s.derived, false) as derived,
           s.edhrec_floor,
           s.edhrec_decks,
           k.id as key_id,
           st.deck_count as key_decks
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
    left join public.commander_keys k on s.derived and k.commander_1 = m.ids[1] and k.commander_2 = m.ids[2]
    left join public.commander_stats st on st.commander_key_id = k.id
  )
  select c.id,
         c.oracle_id, c.name, c.slug, c.mana_value, c.mana_cost, c.type_line, c.color_identity, c.images, c.game_changer,
         c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of, c.legal_commander,
         c.can_be_commander, c.partner_kind, c.partner_qualifier, c.copy_limit, c.is_basic_land, c.artist, c.keywords,
         to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM'),
         g.rate, g.decks_with, g.eligible_decks,
         s.decks_with, s.commander_decks,
         p.decks_with, p.too_early,
         coalesce(r.role_ids, '{}'::uuid[]),
         coalesce(s.prior_rate, pr.prior_rate), coalesce(s.prior_decks, pr.prior_decks), t.edhrec_floor, t.edhrec_decks,
         case when t.derived then coalesce(o.decks_with, 0) end,
         case when t.derived then coalesce(t.key_decks - coalesce(o.eligible_decks, t.key_decks), 0) end,
         c.produced_mana, c.fetchable_mana, c.fetchable_basic_only, c.layout, st.staple_score
  from (select distinct unnest(p_card_ids) as id) ids
  join public.cards c on c.id = ids.id and c.deleted_at is null
  cross join target_set t
  left join public.card_stats st on st.card_id = c.id
  left join public.card_global_stats g on g.card_id = c.id
  left join public.commander_card_scores s
    on t.known and s.commander_1 = t.c1 and s.commander_2 = t.c2 and s.card_id = c.id
  left join public.commander_card_stats o
    on t.derived and o.commander_key_id = t.key_id and o.card_id = c.id
  left join public.commander_card_priors pr
    on t.derived and pr.commander_1 = t.c1 and pr.commander_2 = t.c2 and pr.card_id = c.id
  left join lateral (
    select sum(pt.decks_with)::integer as decks_with, sum(pt.too_early)::integer as too_early
    from public.partner_card_totals pt
    where (not t.known or t.derived) and t.n = 2 and pt.commander_id in (t.c1, t.c2) and pt.card_id = c.id
  ) p on true
  left join lateral (
    select array_agg(cr.role_id order by cr.role_id) as role_ids from public.card_roles cr where cr.card_id = c.id
  ) r on true
$$;

revoke execute on function public.serving_cards(integer[], integer[]) from public;
grant execute on function public.serving_cards(integer[], integer[]) to anon, authenticated, service_role;
