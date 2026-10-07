-- Build a deck from a commander and a bracket (T063; docs/roadmap/scoring-design.md, "Mode C").
--
-- * app_config.scoring.build: the quality floor a build from a collection stops at, and the typical land and basic land
--   counts by colour count (0 to 5) for commanders whose own decks don't say yet: the local corpus's averages over
--   commanders with 10 or more decks, weighted by decks (2026-10-06).
-- * serving_build_pool: everything a build reads, in one round. The pool (the collection's and, beside it, everyone's),
--   the card pairs among its cards with each card's weight, the combos among them (complete, and one card short, each
--   missing card's row once), and the basic lands' rows. A build ranks in TypeScript (`@mtg/core/scoring` `buildDeck`); nothing here scores.

update public.app_config
   set value = value || '{"build": {"qualityFloor": 0.35, "landCounts": [35, 35, 35, 35, 35, 36], "basicLandCounts": [9, 26, 18, 13, 10, 11]}}'::jsonb,
       updated_at = now()
 where key = 'scoring'
   and not value ? 'build';

create or replace function public.serving_build_pool(
  p_commander_ids integer[],
  p_card_ids integer[],
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_basic_names text[],
  p_owned integer[] default null,
  p_limit integer default 400
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids
    from unnest(coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  target as materialized (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           (select k.id from public.commander_keys k
             where k.commander_1 = m.ids[1] and coalesce(k.commander_2, 0) = coalesce(m.ids[2], 0)) as key_id
    from commanders m
  ),
  pool as materialized (
    select 'own'::text as part, p.pool, p."position", p.card
    from public.serving_add_pool(p_commander_ids, p_exclude, p_allow_game_changers, p_owned, p_limit, 'adds') p
    union all
    select 'open'::text, p.pool, p."position", p.card
    from public.serving_add_pool(p_commander_ids, p_exclude, p_allow_game_changers, null, p_limit, 'adds') p
    where p_owned is not null
  ),
  ids as materialized (
    select (p.card).card_id as card_id from pool p where (p.card).card_id is not null
    union
    select x from unnest(coalesce(p_card_ids, '{}'::integer[])) as x
  ),
  own as (
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p
    join target t on p.commander_1 = t.c1 and p.commander_2 = t.c2
    join ids a on a.card_id = p.card_a
    join ids b on b.card_id = p.card_b
  ),
  glob as (
    select p.card_a, p.card_b, p.lift
    from public.card_pairs p
    join ids a on a.card_id = p.card_a
    join ids b on b.card_id = p.card_b
  ),
  weights as (
    select i.card_id, coalesce(s.inclusion_shrunk, g.rate, 0)::real as rate, coalesce(s.decks_with, 0) as key_decks
    from ids i
    cross join target t
    left join public.commander_card_stats s on s.commander_key_id = t.key_id and s.card_id = i.card_id
    left join public.card_global_stats g on g.card_id = i.card_id
  ),
  basics as (
    select c.id from public.cards c
    where c.name = any (coalesce(p_basic_names, '{}'::text[])) and c.is_basic_land and c.deleted_at is null
  ),
  combos as materialized (
    select * from public.serving_deck_combos(array(select card_id from ids), p_commander_ids, p_exclude, p_allow_game_changers, true)
  )
  select jsonb_build_object(
    'pool', coalesce((select jsonb_agg(jsonb_build_object('part', part, 'pool', pool, 'position', "position", 'card', card)) from pool), '[]'::jsonb),
    'own', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from own), '[]'::jsonb),
    'global', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from glob), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(card_id, rate, key_decks)) from weights), '[]'::jsonb),
    -- Each missing card once: many combos share one.
    'combos', coalesce((select jsonb_agg(to_jsonb(c) - 'card') from combos c), '[]'::jsonb),
    'missing', coalesce(
      (select jsonb_agg(m.card) from (select distinct on (c.missing) c.card from combos c where c.missing is not null order by c.missing) m),
      '[]'::jsonb),
    'basics', coalesce(
      (select jsonb_agg(to_jsonb(r)) from public.serving_cards(p_commander_ids, array(select id from basics)) r),
      '[]'::jsonb)
  )
$$;

revoke all on function public.serving_build_pool(integer[], integer[], integer[], boolean, text[], integer[], integer) from public;
grant execute on function public.serving_build_pool(integer[], integer[], integer[], boolean, text[], integer[], integer)
  to anon, authenticated, service_role;
