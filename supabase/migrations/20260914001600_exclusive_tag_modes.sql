-- Some functional tags are mutually exclusive ways of doing a job: a board wipe (sweeper) and single-target removal
-- (spot removal) both sit under "removal" and share broad tags like removal-creature, so Swords to Plowshares scored
-- 0.50 as a Fumigate replacement. For each group of exclusive modes (a tag and its descendants), a candidate that has
-- only another mode than the target's keeps `penalty` of its tag similarity. Candidates with none of the group's modes,
-- or with the target's mode too (modal cards), are unaffected.
insert into public.app_config (key, value, is_public)
values (
  'functional_tag_exclusive_groups',
  jsonb_build_object(
    'penalty', 0.3,
    'groups', jsonb_build_array(
      jsonb_build_array(
        '3fb7e4fd-5304-4120-b7c4-8a89f70ad3f0', -- sweeper
        'cc12d27d-1d0e-4849-9551-71caead74d24'  -- spot removal
      )
    )
  ),
  false
)
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.rec_swap_candidates(
  p_target integer,
  p_exclude integer[],
  p_identity_mask smallint,
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 60
)
returns table (card_id integer, tag_similarity real, staple_score real, is_functional_twin boolean, matches jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with target_card as (
    select mana_value, equivalence_base_id from public.cards where id = p_target
  ),
  eligible as not materialized (
    select c.id, c.name, c.mana_value, c.equivalence_base_id
    from public.cards c
    where c.id <> p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
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
      c.candidate_tag,
      t.ancestor_id,
      t.target_depth + c.candidate_depth as distance
    from target_ancestors t
    join candidate_ancestors c on c.ancestor_id = t.ancestor_id
    order by c.card_id, t.target_tag, t.target_depth + c.candidate_depth, t.ancestor_id
  ),
  tag_scored as materialized (
    select
      p.card_id,
      least(1, sum(p.target_idf * power(0.5, p.distance)) / (select total from denominator))::real as exact_similarity,
      jsonb_agg(
        jsonb_build_object(
          'targetTagId', p.target_tag,
          'candidateTagId', p.candidate_tag,
          'viaTagId', case when p.distance = 0 then null else p.ancestor_id end,
          'distance', p.distance
        )
        order by p.distance
      ) as matches
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
  -- A card has a mode when it carries the mode tag or any of its descendants.
  target_modes as (
    select distinct em.group_no, em.mode_id
    from exclusive_modes em
    join public.tag_closure tc on tc.ancestor_id = em.mode_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id and ct.card_id = p_target
  ),
  candidate_modes as (
    select distinct ct.card_id, em.group_no, em.mode_id
    from exclusive_modes em
    join (select distinct group_no from target_modes) tg on tg.group_no = em.group_no
    join public.tag_closure tc on tc.ancestor_id = em.mode_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
    join tag_scored s on s.card_id = ct.card_id
  ),
  -- Candidates with a mode from a group where they share none of the target's modes.
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
      w.card_id is not null as is_functional_twin,
      coalesce(s.matches, '[]'::jsonb) as matches
    from tag_scored s
    full join twins w on w.card_id = s.card_id
    left join candidate_roles cr on cr.card_id = s.card_id
    left join conflicted cf on cf.card_id = s.card_id
  )
  select
    x.card_id,
    x.tag_similarity,
    coalesce(st.staple_score, 0)::real as staple_score,
    x.is_functional_twin,
    x.matches
  from combined x
  join eligible e on e.id = x.card_id
  left join public.card_stats st on st.card_id = x.card_id
  order by
    x.is_functional_twin desc,
    (0.4 * x.tag_similarity
      + 0.2 * coalesce(st.staple_score, 0)
      + 0.1 * exp(-abs(e.mana_value - coalesce((select mana_value from target_card), e.mana_value)) / 1.5)) desc,
    e.name
  limit p_limit
$$;
