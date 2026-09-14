-- 20260914000700 computed role overlap by walking every candidate's tags up the full hierarchy: ~3.3s for a broad
-- card like Lightning Bolt, over the 3s statement timeout for anonymous API requests. Role overlap now reuses the
-- ancestors already gathered for tag matching (up to 2 levels above each tag). Functional roots are shallow,
-- so this finds the same roles in practice; candidate_ancestors is materialized once and read twice.

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
  eligible as (
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
  tag_scored as (
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
        else (0.5 * s.exact_similarity + 0.5 * least(1, coalesce(cr.shared_roles, 0) / (select n from role_count)))::real
      end as tag_similarity,
      w.card_id is not null as is_functional_twin,
      coalesce(s.matches, '[]'::jsonb) as matches
    from tag_scored s
    full join twins w on w.card_id = s.card_id
    left join candidate_roles cr on cr.card_id = s.card_id
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
