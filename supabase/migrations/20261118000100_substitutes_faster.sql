-- precompute_substitutes, the same lists in about 40% less time (measured on two samples of 200 random cards: 24.0 to
-- 14.3 s and 22.0 to 13.2 s, every row identical). The worker calls it once per card on every rebuild, so on the
-- hosted 2-CPU database a full rebuild of every list drops from about three and a half hours to about two.
--
-- Two steps did work they didn't need:
-- - pool_weights read four values out of app_config.scoring for every candidate (eight thousand of them for a removal
--   spell), detoasting the whole row each time. Materialized, it is read once.
-- - candidate_modes joined every candidate's tags to the tag hierarchy (150,000 rows) before keeping the few under the
--   target's exclusive modes. mode_tags now finds the tags under those modes first.
--
-- Everything else is as in 20261006000300_scoring_config.sql, enable_nestloop off included: on, the planner picks index
-- loops that are four times slower here.

create or replace function public.precompute_substitutes(p_target integer, p_depth integer)
returns table (card_id integer, tag_similarity real, is_functional_twin boolean)
language sql
stable
security definer
set search_path = ''
set enable_nestloop = off
as $$
  with target_card as (
    select mana_value, equivalence_base_id, color_identity from public.cards where id = p_target
  ),
  eligible as not materialized (
    select c.id, c.name, c.mana_value, c.equivalence_base_id, c.color_identity, c.game_changer
    from public.cards c
    where c.id <> p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
  ),
  functional as materialized (
    select tag_id from public.functional_tags
  ),
  allowed_roots as (
    select r.id::uuid as id
    from public.app_config cfg
    cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as r (id)
    where cfg.key = 'functional_tag_roots'
  ),
  target_tags as (
    select ct.tag_id, greatest(t.idf, 0.05) as idf
    from public.card_tags ct
    join functional f on f.tag_id = ct.tag_id
    join public.tags t on t.id = ct.tag_id
    where ct.card_id = p_target
  ),
  denominator as (
    select sum(idf) as total from target_tags
  ),
  target_ancestors as materialized (
    select tt.tag_id as target_tag, tt.idf as target_idf, tc.ancestor_id, tc.depth as target_depth
    from target_tags tt
    join public.tag_closure tc on tc.descendant_id = tt.tag_id and tc.depth <= 2
    join functional f on f.tag_id = tc.ancestor_id
  ),
  candidate_ancestors as materialized (
    select ct.card_id, ct.tag_id as candidate_tag, tc.ancestor_id, tc.depth as candidate_depth
    from (select distinct ancestor_id from target_ancestors) a
    join public.tag_closure tc on tc.ancestor_id = a.ancestor_id and tc.depth <= 2
    join functional f on f.tag_id = tc.descendant_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
    join eligible e on e.id = ct.card_id
  ),
  pairs as (
    select distinct on (c.card_id, t.target_tag)
      c.card_id,
      t.target_tag,
      t.target_idf,
      t.target_depth + c.candidate_depth as distance
    from target_ancestors t
    join candidate_ancestors c on c.ancestor_id = t.ancestor_id
    order by c.card_id, t.target_tag, t.target_depth + c.candidate_depth, t.ancestor_id
  ),
  tag_scored as materialized (
    select p.card_id,
           least(1, sum(p.target_idf * power(0.5, p.distance)) / (select total from denominator))::real as exact_similarity
    from pairs p
    group by p.card_id
  ),
  target_roles as (
    select distinct ta.ancestor_id as role_id
    from target_ancestors ta
    join allowed_roots r on r.id = ta.ancestor_id
  ),
  role_count as (
    select greatest(count(*), 1)::real as n from target_roles
  ),
  candidate_roles as (
    select ca.card_id, count(distinct ca.ancestor_id)::real as shared_roles
    from candidate_ancestors ca
    where ca.ancestor_id in (select role_id from target_roles)
    group by ca.card_id
  ),
  exclusive_config as (
    select coalesce((cfg.value ->> 'penalty')::real, 1) as penalty, cfg.value -> 'groups' as groups
    from public.app_config cfg
    where cfg.key = 'functional_tag_exclusive_groups'
  ),
  exclusive_modes as (
    select g.group_no, m.id::uuid as mode_id
    from exclusive_config x
    cross join lateral jsonb_array_elements(x.groups) with ordinality as g (members, group_no)
    cross join lateral jsonb_array_elements_text(g.members) as m (id)
  ),
  target_modes as (
    select distinct em.group_no, em.mode_id
    from exclusive_modes em
    join public.tag_closure tc on tc.ancestor_id = em.mode_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id and ct.card_id = p_target
  ),
  mode_tags as materialized (
    select em.group_no, em.mode_id, tc.descendant_id as tag_id
    from exclusive_modes em
    join (select distinct group_no from target_modes) tg on tg.group_no = em.group_no
    join public.tag_closure tc on tc.ancestor_id = em.mode_id
  ),
  candidate_modes as (
    select distinct ct.card_id, mt.group_no, mt.mode_id
    from mode_tags mt
    join public.card_tags ct on ct.tag_id = mt.tag_id
    join tag_scored s on s.card_id = ct.card_id
  ),
  conflicted as (
    select distinct cm.card_id
    from candidate_modes cm
    where not exists (
      select 1
      from candidate_modes same
      join target_modes tm on tm.group_no = same.group_no and tm.mode_id = same.mode_id
      where same.card_id = cm.card_id and same.group_no = cm.group_no
    )
  ),
  twins as (
    select e.id as card_id
    from eligible e, target_card t
    where t.equivalence_base_id is not null and e.equivalence_base_id = t.equivalence_base_id
  ),
  combined as (
    select
      coalesce(s.card_id, w.card_id) as card_id,
      case
        when w.card_id is not null then 1::real
        else (
          (0.5 * s.exact_similarity + 0.5 * least(1, coalesce(cr.shared_roles, 0) / (select n from role_count)))
          * case when cf.card_id is not null then coalesce((select penalty from exclusive_config), 1) else 1 end
        )::real
      end as tag_similarity,
      w.card_id is not null as is_functional_twin
    from tag_scored s
    full join twins w on w.card_id = s.card_id
    left join candidate_roles cr on cr.card_id = s.card_id
    left join conflicted cf on cf.card_id = s.card_id
  ),
  -- The pool order's weights: app_config.scoring's no-collection swap weights for tag similarity, staple score and mana
  -- value, and its mana value falloff.
  pool_weights as materialized (
    select (cfg.value #>> '{weights,swap,collection_less,tag}')::double precision as tag,
           (cfg.value #>> '{weights,swap,collection_less,staple}')::double precision as staple,
           (cfg.value #>> '{weights,swap,collection_less,manaValue}')::double precision as mana_value,
           (cfg.value #>> '{swap,manaValueFalloff}')::double precision as falloff
    from public.app_config cfg
    where cfg.key = 'scoring'
  ),
  -- Every candidate in the swap pool's order, which is the same whatever the deck's colours: a colour mask
  -- only removes candidates, it never reorders the rest.
  ranked as materialized (
    select x.card_id,
           x.tag_similarity,
           x.is_functional_twin,
           e.color_identity,
           e.game_changer,
           row_number() over (
             order by x.is_functional_twin desc,
                      (w.tag * x.tag_similarity
                        + w.staple * coalesce(st.staple_score, 0)
                        + w.mana_value * exp(greatest(-abs(e.mana_value - coalesce((select mana_value from target_card), e.mana_value)) / w.falloff, -700))) desc,
                      e.name
           ) as pool_rank
    from combined x
    join eligible e on e.id = x.card_id
    left join public.card_stats st on st.card_id = x.card_id
    cross join pool_weights w
  ),
  -- Every colour identity a deck holding this card can have: the masks that contain the card's own.
  masks as (
    select m::smallint as mask
    from generate_series(0, 31) as m, target_card t
    where (t.color_identity & ~m) = 0
  ),
  -- The first p_depth candidates inside each mask, and the first p_depth that aren't Game Changers (a bracket that
  -- allows none reads past the ones it skips).
  picked as (
    select p.card_id
    from masks k
    cross join lateral (
      select r.card_id from ranked r where (r.color_identity & ~k.mask) = 0 order by r.pool_rank limit p_depth
    ) p
    union
    select p.card_id
    from masks k
    cross join lateral (
      select r.card_id from ranked r
      where (r.color_identity & ~k.mask) = 0 and not r.game_changer
      order by r.pool_rank limit p_depth
    ) p
  )
  select r.card_id, r.tag_similarity, r.is_functional_twin
  from ranked r
  where r.card_id in (select card_id from picked)
$$;

revoke execute on function public.precompute_substitutes(integer, integer) from public, anon, authenticated;
grant execute on function public.precompute_substitutes(integer, integer) to service_role;
