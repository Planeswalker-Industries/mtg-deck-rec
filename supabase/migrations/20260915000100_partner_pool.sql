-- Partner pairs split their decks across many pairings (Rograkh, Son of Rohgahh leads with 25 different partners), so
-- most pairs never reach minDecks on their own. A commander key with too few decks of its own now also counts every key
-- that shares one of its commanders (a partner's solo decks and its other pairings), each of those decks at this weight.
-- Measured 2026-09-15 on the four pairs with 30+ decks of their own, leaving those decks out: of the pair's own top 50
-- cards, 47 were in the pooled top 50 at 0.25, 44 at full weight, and 29 from play rates across all decks of the
-- pair's colors.
update public.app_config
set value = value || '{"partnerPoolWeight": 0.25}'::jsonb, updated_at = now()
where key = 'corpus';

-- Cards to add from several commander keys, each with its own weight and color identity. A card's eligible decks count
-- only the keys whose colors allow it, weighted like its play count. When a key has no row for a card, all of that key's
-- decks count as eligible (the card's release month isn't known here); the app re-scores the pool with exact counts.
-- Replaces the p_deck_count version, which stays until deployed apps no longer call it.
-- Runs with enable_nestloop off, like rec_swap_candidates: planned inside the function, the argument-dependent CTEs are
-- estimated at about one row and nested loops took 1.6 s (one key) to 2.7 s (29 keys) locally; hash joins take ~40 ms.
create function public.rec_add_candidates(
  p_key_ids integer[],
  p_key_weights real[],
  p_alpha real,
  p_identity_mask smallint,
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 400
)
returns table (card_id integer, decks_with integer, baseline real)
language sql
stable
security definer
set search_path = ''
set enable_nestloop = off
as $$
  with sources as (
    select k.id, k.color_identity, s.deck_count, coalesce(w.weight, 1)::double precision as weight
    from unnest(coalesce(p_key_ids, '{}'::integer[]), coalesce(p_key_weights, '{}'::real[])) as w(key_id, weight)
    join public.commander_keys k on k.id = w.key_id
    join public.commander_stats s on s.commander_key_id = k.id
  ),
  identity_decks as (
    -- Weighted decks whose colors allow a card of each color identity.
    select i.color_identity, coalesce(sum(src.weight * src.deck_count), 0) as decks
    from generate_series(0, 31) as i(color_identity)
    left join sources src on (i.color_identity & ~src.color_identity::integer) = 0
    group by i.color_identity
  ),
  commander_cards as (
    select
      s.card_id,
      sum(src.weight * s.decks_with) as decks_with,
      -- Each key's decks last updated before the card came out.
      sum(src.weight * (src.deck_count - coalesce(s.eligible_decks, src.deck_count))) as too_early
    from public.commander_card_stats s
    join sources src on src.id = s.commander_key_id
    group by s.card_id
  ),
  pool as (
    select
      g.card_id,
      c.name,
      coalesce(cc.decks_with, 0) as decks_with,
      greatest(coalesce(d.decks - cc.too_early, 0), coalesce(cc.decks_with, 0)) as eligible_decks,
      g.rate::double precision as baseline
    from public.card_global_stats g
    join public.cards c on c.id = g.card_id
    left join commander_cards cc on cc.card_id = g.card_id
    left join identity_decks d on d.color_identity = c.color_identity
    where (not exists (select 1 from sources) or cc.card_id is not null)
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
  ),
  scored as (
    select p.*, (p.decks_with + p_alpha * p.baseline) / (p.eligible_decks + p_alpha) as inclusion
    from pool p
  )
  select s.card_id, round(s.decks_with)::integer, s.baseline::real
  from scored s
  order by
    case
      when not exists (select 1 from sources) then sqrt(greatest(s.baseline, 0))
      else 0.6 * (0.5 + 0.5 * greatest(-1, least(1, (s.inclusion - s.baseline) / 0.3))) + 0.4 * sqrt(least(1, greatest(s.inclusion, 0)))
    end desc,
    s.name
  limit p_limit
$$;

revoke execute on function public.rec_add_candidates(integer[], real[], real, smallint, integer[], boolean, integer[], integer) from public;
grant execute on function public.rec_add_candidates(integer[], real[], real, smallint, integer[], boolean, integer[], integer)
  to anon, authenticated, service_role;

-- The same planner setting for the older version while deployed apps still call it.
alter function public.rec_add_candidates(integer[], integer, real, smallint, integer[], boolean, integer[], integer)
  set enable_nestloop = off;
