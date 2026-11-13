-- Swap ladder (T088). serving_swap_candidates returns up to three rungs in one round, the rung on each row:
--   1 similar tags (the stored substitutes, as before);
--   2 same job: cards that share a tracked role with the target (card_roles);
--   3 similar slot: the target's card type at a mana value within swap.slotManaValueRange.
-- A lower rung is read only when the rungs above give fewer than swap.ladderMinSuggestions (rung 1 counts its rows at
-- or above swap.tagSimilarityFloor, the ones the app keeps). Rungs 2 and 3 read the catalog, or the collection when
-- p_owned is given, never the stored substitutes. Their pool order is rung 1's without the tag term.
-- Only the keys that are missing are written, so a value the owner has tuned is never overwritten.

update public.app_config
   set value = jsonb_set(value, '{swap,ladderMinSuggestions}', '3'::jsonb), updated_at = now()
 where key = 'scoring' and not (value -> 'swap') ? 'ladderMinSuggestions';

update public.app_config
   set value = jsonb_set(value, '{swap,slotManaValueRange}', '1'::jsonb), updated_at = now()
 where key = 'scoring' and not (value -> 'swap') ? 'slotManaValueRange';

-- Rung 3 reads a card's one category with public.card_category (20260922000350_search_cards_filtered.sql), the same
-- precedence as cardCategory in @mtg/core/scoring.

-- The return columns change (rung), so the function is dropped and created; arguments, grants and callers as before.
drop function public.serving_swap_candidates(integer, integer[], integer[], boolean, integer[], integer, smallint);

create function public.serving_swap_candidates(
  p_target integer,
  p_commander_ids integer[],
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 60,
  p_identity_mask smallint default null
)
returns table (
  tag_similarity real,
  staple_score real,
  is_functional_twin boolean,
  matches jsonb,
  match_tags jsonb,
  card public.serving_card,
  rung smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_card as (
    select mana_value, public.card_category(type_line) as category from public.cards where id = p_target
  ),
  colours as (
    select coalesce(
             p_identity_mask,
             (select bit_or(c.color_identity) from public.cards c where c.id = any (coalesce(p_commander_ids, '{}'::integer[])) and c.deleted_at is null),
             0
           )::smallint as mask
  ),
  pool_weights as (
    select (cfg.value #>> '{weights,swap,collection_less,tag}')::double precision as tag,
           (cfg.value #>> '{weights,swap,collection_less,staple}')::double precision as staple,
           (cfg.value #>> '{weights,swap,collection_less,manaValue}')::double precision as mana_value,
           (cfg.value #>> '{swap,manaValueFalloff}')::double precision as falloff,
           (cfg.value #>> '{swap,tagSimilarityFloor}')::double precision as floor,
           (cfg.value #>> '{swap,ladderMinSuggestions}')::integer as ladder_min,
           (cfg.value #>> '{swap,slotManaValueRange}')::double precision as slot_range
    from public.app_config cfg
    where cfg.key = 'scoring'
  ),
  -- The collection, when one is given. The wide rungs start from it (or match it as a hashed subquery), never
  -- `= any`: it can hold tens of thousands of ids.
  owned as materialized (
    select distinct unnest(p_owned) as id
  ),
  ranked as materialized (
    select s.substitute_id as card_id,
           s.tag_similarity,
           s.is_functional_twin,
           coalesce(st.staple_score, 0)::real as staple_score,
           row_number() over (
             order by s.is_functional_twin desc,
                      (w.tag * s.tag_similarity
                        + w.staple * coalesce(st.staple_score, 0)
                        + w.mana_value * exp(greatest(-abs(c.mana_value - coalesce((select mana_value from target_card), c.mana_value)) / w.falloff, -700))) desc,
                      c.name
           ) as "position"
    from public.card_substitutes s
    join public.cards c on c.id = s.substitute_id
    left join public.card_stats st on st.card_id = s.substitute_id
    cross join colours
    cross join pool_weights w
    where s.card_id = p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~colours.mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      -- Hashed, not `= any`: with a collection the planner otherwise starts from its ids (one index probe each, about
      -- 160 ms for 1,661 cards) and not from the target's substitutes.
      and (p_owned is null or c.id in (select o.id from owned o))
  ),
  picked as materialized (
    select * from ranked where "position" <= p_limit
  ),
  -- What rung 1 gives: its rows the app keeps.
  rung1 as materialized (
    select card_id from ranked where tag_similarity >= (select floor from pool_weights)
  ),
  -- Rung 2. The first condition holds no column, so the scan is skipped outright when rung 1 has enough.
  role_ranked as (
    select c.id as card_id,
           coalesce(st.staple_score, 0)::real as staple_score,
           row_number() over (
             order by (w.staple * coalesce(st.staple_score, 0)
                        + w.mana_value * exp(greatest(-abs(c.mana_value - t.mana_value) / w.falloff, -700))) desc,
                      c.name
           ) as "position"
    from (
      select distinct cr.card_id
      from public.card_roles tr
      join public.card_roles cr on cr.role_id = tr.role_id
      where tr.card_id = p_target
        and (p_owned is null or cr.card_id in (select o.id from owned o))
    ) shared
    join public.cards c on c.id = shared.card_id
    left join public.card_stats st on st.card_id = c.id
    cross join colours
    cross join pool_weights w
    cross join target_card t
    where (select count(*) from rung1) < (select ladder_min from pool_weights)
      and c.id <> p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~colours.mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and c.id not in (select r.card_id from rung1 r)
  ),
  role_picked as materialized (
    select * from role_ranked where "position" <= p_limit
  ),
  -- Rung 3, read only when rungs 1 and 2 together are short.
  slot_ranked as (
    select c.id as card_id,
           coalesce(st.staple_score, 0)::real as staple_score,
           row_number() over (
             order by (w.staple * coalesce(st.staple_score, 0)
                        + w.mana_value * exp(greatest(-abs(c.mana_value - t.mana_value) / w.falloff, -700))) desc,
                      c.name
           ) as "position"
    from (
      -- A collection's cards are read by id: a few thousand rows, not the catalog.
      select oc.id, oc.name, oc.mana_value, oc.type_line, oc.color_identity, oc.game_changer
      from owned o
      join public.cards oc on oc.id = o.id
      where oc.deleted_at is null and oc.legal_commander = 'legal' and not oc.is_basic_land
      union all
      select ac.id, ac.name, ac.mana_value, ac.type_line, ac.color_identity, ac.game_changer
      from public.cards ac
      where p_owned is null and ac.deleted_at is null and ac.legal_commander = 'legal' and not ac.is_basic_land
    ) c
    left join public.card_stats st on st.card_id = c.id
    cross join colours
    cross join pool_weights w
    cross join target_card t
    where (select count(*) from rung1) + (select count(*) from role_picked) < (select ladder_min from pool_weights)
      and c.id <> p_target
      and (c.color_identity & ~colours.mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and abs(c.mana_value - t.mana_value) <= w.slot_range
      and public.card_category(c.type_line) = t.category
      and c.id not in (select r.card_id from rung1 r)
      and c.id not in (select r.card_id from role_picked r)
  ),
  slot_picked as materialized (
    select * from slot_ranked where "position" <= p_limit
  ),
  functional as materialized (
    select tag_id from public.functional_tags
  ),
  target_ancestors as materialized (
    select ct.tag_id as target_tag, tc.ancestor_id, tc.depth as target_depth
    from public.card_tags ct
    join functional f on f.tag_id = ct.tag_id
    join public.tag_closure tc on tc.descendant_id = ct.tag_id and tc.depth <= 2
    join functional fa on fa.tag_id = tc.ancestor_id
    where ct.card_id = p_target
  ),
  candidate_ancestors as materialized (
    select ct.card_id, ct.tag_id as candidate_tag, tc.ancestor_id, tc.depth as candidate_depth
    from picked p
    join public.card_tags ct on ct.card_id = p.card_id
    join functional f on f.tag_id = ct.tag_id
    join public.tag_closure tc on tc.descendant_id = ct.tag_id and tc.depth <= 2
    where tc.ancestor_id in (select ancestor_id from target_ancestors)
  ),
  -- rec_swap_candidates' pair rule, with the candidate tag as the last tie-break: where a card has two tags equally
  -- close through the same ancestor, that function kept whichever its join met first.
  pairs as (
    select distinct on (c.card_id, t.target_tag)
      c.card_id,
      t.target_tag,
      c.candidate_tag,
      t.ancestor_id,
      t.target_depth + c.candidate_depth as distance
    from target_ancestors t
    join candidate_ancestors c on c.ancestor_id = t.ancestor_id
    order by c.card_id, t.target_tag, t.target_depth + c.candidate_depth, t.ancestor_id, c.candidate_tag
  ),
  -- Materialized: estimated at one row, the aggregate was planned as the inner side of a nested loop and redone for
  -- every candidate (220 sorts of ~2,000 rows, about 270 ms locally).
  matched as materialized (
    select p.card_id,
           jsonb_agg(
             jsonb_build_object(
               'targetTagId', p.target_tag,
               'candidateTagId', p.candidate_tag,
               'viaTagId', case when p.distance = 0 then null else p.ancestor_id end,
               'distance', p.distance
             )
             order by p.distance, p.target_tag
           ) as matches
    from pairs p
    group by p.card_id
  ),
  -- The tags those matches name, with the slugs and labels the app shows. Materialized for the reason `matched` is
  -- (inlined, it was aggregated again for every candidate: about 200 ms for 220).
  match_tags as materialized (
    select p.card_id, jsonb_agg(distinct jsonb_build_object('id', t.id, 'slug', t.slug, 'label', t.label)) as tags
    from pairs p
    cross join lateral (
      values (p.target_tag), (p.candidate_tag), (case when p.distance = 0 then null else p.ancestor_id end)
    ) as v (tag_id)
    join public.tags t on t.id = v.tag_id
    group by p.card_id
  ),
  -- Rung 2's matches: the roles shared with the target (roles are tags), each as its own target and candidate tag.
  role_matches as materialized (
    select p.card_id,
           jsonb_agg(
             jsonb_build_object('targetTagId', cr.role_id, 'candidateTagId', cr.role_id, 'viaTagId', null, 'distance', 0)
             order by cr.role_id
           ) as matches,
           jsonb_agg(jsonb_build_object('id', t.id, 'slug', t.slug, 'label', t.label) order by t.id) as tags
    from role_picked p
    join public.card_roles cr on cr.card_id = p.card_id
    join public.card_roles tr on tr.card_id = p_target and tr.role_id = cr.role_id
    join public.tags t on t.id = cr.role_id
    group by p.card_id
  ),
  laddered as materialized (
    select card_id, tag_similarity, staple_score, is_functional_twin, 1::smallint as rung, "position" from picked
    union all
    select card_id, 0::real, staple_score, false, 2::smallint, "position" from role_picked
    union all
    select card_id, 0::real, staple_score, false, 3::smallint, "position" from slot_picked
  )
  select l.tag_similarity, l.staple_score, l.is_functional_twin,
         coalesce(case l.rung when 1 then m.matches when 2 then rm.matches end, '[]'::jsonb),
         coalesce(case l.rung when 1 then mt.tags when 2 then rm.tags end, '[]'::jsonb),
         r, l.rung
  from laddered l
  left join matched m on l.rung = 1 and m.card_id = l.card_id
  left join match_tags mt on l.rung = 1 and mt.card_id = l.card_id
  left join role_matches rm on l.rung = 2 and rm.card_id = l.card_id
  join public.serving_cards(p_commander_ids, array(select card_id from laddered)) r on r.card_id = l.card_id
  order by l.rung, l."position"
$$;

revoke execute on function public.serving_swap_candidates(integer, integer[], integer[], boolean, integer[], integer, smallint) from public;
grant execute on function public.serving_swap_candidates(integer, integer[], integer[], boolean, integer[], integer, smallint)
  to anon, authenticated, service_role;
