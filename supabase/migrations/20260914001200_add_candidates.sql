-- Cards to add: what a commander's corpus decks run (or, without enough of them, what is widely played in decks of
-- these colors), behind the same gates as swap candidates. The pool is ordered by the app's corpus score
-- (@mtg/core/scoring commanderCorpusScore, or √baseline without commander decks); the app re-scores it with role gaps
-- and groups it by card type. Change both together.
create function public.rec_add_candidates(
  p_key_ids integer[],
  p_deck_count integer,
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
as $$
  with keys as (
    select coalesce(p_key_ids, '{}'::integer[]) as ids
  ),
  commander_cards as (
    select s.card_id, sum(s.decks_with)::integer as decks_with
    from public.commander_card_stats s, keys
    where s.commander_key_id = any (keys.ids)
    group by s.card_id
  ),
  pool as (
    select g.card_id, coalesce(cc.decks_with, 0) as decks_with, g.rate as baseline
    from public.card_global_stats g
    cross join keys
    left join commander_cards cc on cc.card_id = g.card_id
    where cardinality(keys.ids) = 0 or cc.card_id is not null
  ),
  scored as (
    select
      p.card_id,
      p.decks_with,
      p.baseline,
      (p.decks_with + p_alpha * p.baseline) / (greatest(p_deck_count, 0) + p_alpha) as inclusion
    from pool p
  )
  select s.card_id, s.decks_with, s.baseline
  from scored s
  cross join keys
  join public.cards c on c.id = s.card_id
  where c.deleted_at is null
    and c.legal_commander = 'legal'
    and not c.is_basic_land
    and (c.color_identity & ~p_identity_mask) = 0
    and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
    and (p_allow_game_changers or not c.game_changer)
    and (p_owned is null or c.id = any (p_owned))
  order by
    case
      when cardinality(keys.ids) = 0 then sqrt(greatest(s.baseline, 0))
      else 0.6 * (0.5 + 0.5 * greatest(-1, least(1, (s.inclusion - s.baseline) / 0.3))) + 0.4 * sqrt(least(1, greatest(s.inclusion, 0)))
    end desc,
    c.name
  limit p_limit
$$;

revoke execute on function public.rec_add_candidates(integer[], integer, real, smallint, integer[], boolean, integer[], integer) from public;
grant execute on function public.rec_add_candidates(integer[], integer, real, smallint, integer[], boolean, integer[], integer)
  to anon, authenticated, service_role;
