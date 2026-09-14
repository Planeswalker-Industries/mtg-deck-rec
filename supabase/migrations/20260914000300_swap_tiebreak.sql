-- Many candidates tie on tag similarity (e.g. dozens of exact "counterspell" matches). Break ties by closeness in
-- mana value to the card being replaced, then by name, so the candidate pool isn't cut by arbitrary card id order.

create or replace function public.rec_swap_candidates(
  p_target integer,
  p_exclude integer[],
  p_identity_mask smallint,
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 60
)
returns table (card_id integer, tag_similarity real, matches jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with target_card as (
    select mana_value from public.cards where id = p_target
  ),
  target_tags as (
    select ct.tag_id, greatest(t.idf, 0.05) as idf
    from public.card_tags ct
    join public.functional_tags f on f.tag_id = ct.tag_id
    join public.tags t on t.id = ct.tag_id
    where ct.card_id = p_target
  ),
  denominator as (
    select sum(idf) as total from target_tags
  ),
  target_ancestors as (
    select tt.tag_id as target_tag, tt.idf as target_idf, tc.ancestor_id, tc.depth as target_depth
    from target_tags tt
    join public.tag_closure tc on tc.descendant_id = tt.tag_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.ancestor_id
  ),
  candidate_ancestors as (
    select ct.card_id, ct.tag_id as candidate_tag, tc.ancestor_id, tc.depth as candidate_depth
    from (select distinct ancestor_id from target_ancestors) a
    join public.tag_closure tc on tc.ancestor_id = a.ancestor_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.descendant_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
    join public.cards c on c.id = ct.card_id
    where ct.card_id <> p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
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
  scored as (
    select
      p.card_id,
      least(1, sum(p.target_idf * power(0.5, p.distance)) / (select total from denominator))::real as tag_similarity,
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
  )
  select s.card_id, s.tag_similarity, s.matches
  from scored s
  join public.cards c on c.id = s.card_id
  order by
    s.tag_similarity desc,
    abs(c.mana_value - coalesce((select mana_value from target_card), c.mana_value)),
    c.name
  limit p_limit
$$;
