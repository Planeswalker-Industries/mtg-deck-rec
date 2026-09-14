-- Functional twins: rules-identical cards with different names (Evolving Wilds / Terramorphic Expanse, Universes
-- Beyond renames like Banishing Light / Web Up). They stay separate cards: Commander singleton is by name, so a deck
-- may run both, and legality or Game Changer status is per name. Instead they link to a base card (the earliest
-- printed member), and collated data lives on card_stats for every member.
-- Reprints, alternate art and flavor-named printings are already one card: they share an oracle_id (see printings).

alter table public.cards
  add column rules_hash bytea, -- hash of rules-relevant fields with the card's own name masked; set by the worker
  add column equivalence_base_id integer references public.cards (id);

create index cards_rules_hash on public.cards (rules_hash) where rules_hash is not null;
create index cards_equivalence_base on public.cards (equivalence_base_id) where equivalence_base_id is not null;

-- Printing statistics from All Cards. Counts are collated across a card's twins, so every member of a group
-- carries the group's reprint breadth and staple score.
create table public.card_stats (
  card_id integer primary key references public.cards (id) on delete cascade,
  paper_printings integer not null, -- non-digital printings in any language
  paper_sets integer not null, -- distinct paper sets
  commander_products integer not null, -- distinct Commander precon sets (set_type 'commander')
  first_printed_at date,
  cheapest_usd numeric(10, 2),
  cheapest_finish text check (cheapest_finish in ('nonfoil', 'foil', 'etched')),
  staple_score real not null default 0, -- 0..1 percentile of reprint breadth; weights Commander precons heavily
  computed_at timestamptz not null default now()
);

alter table public.card_stats enable row level security;
create policy public_read on public.card_stats for select to anon, authenticated using (true);
grant select on public.card_stats to anon, authenticated;
grant all on public.card_stats to service_role;

-- Swap candidates now also return the staple score and whether the candidate is a functional twin of the target.
-- Twins are always included (a new rename may not be tagged yet) and score as a perfect functional match.
drop function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer);

create function public.rec_swap_candidates(
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
  ),
  twins as (
    select e.id as card_id
    from eligible e, target_card t
    where t.equivalence_base_id is not null and e.equivalence_base_id = t.equivalence_base_id
  ),
  combined as (
    select
      coalesce(s.card_id, w.card_id) as card_id,
      case when w.card_id is not null then 1::real else s.tag_similarity end as tag_similarity,
      w.card_id is not null as is_functional_twin,
      coalesce(s.matches, '[]'::jsonb) as matches
    from tag_scored s
    full join twins w on w.card_id = s.card_id
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
  -- Pool selection mirrors the app's blend when there's no play-rate data (tag 0.62, staple 0.23, mana value 0.15).
  -- Similarity alone ties dozens of obscure exact matches and would push staples like Swords to Plowshares out of the pool.
  order by
    x.is_functional_twin desc,
    0.62 * x.tag_similarity
      + 0.23 * coalesce(st.staple_score, 0)
      + 0.15 * exp(-abs(e.mana_value - coalesce((select mana_value from target_card), e.mana_value)) / 1.5) desc,
    e.name
  limit p_limit
$$;

revoke execute on function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer) from public;
grant execute on function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer)
  to anon, authenticated, service_role;
