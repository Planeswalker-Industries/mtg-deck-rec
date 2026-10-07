-- Scoring weights and thresholds into the database (T057). The repo is public, so no weight or threshold stays in code:
-- `app_config.scoring` (private: only the app's server and the worker read it) holds the add and swap weights, the
-- corpus score's shape, the swap thresholds and the cut thresholds. The values are today's, so nothing ranks
-- differently; the offline evaluation (T058) is what changes them from here on.
--
-- The SQL that orders the stored swap pool and the partner pool reads the same row, so a change there reorders them
-- without a migration (the substitutes worker hashes the swap weights and rebuilds every list when they move).

insert into public.app_config (key, value, is_public) values ('scoring', $json${
  "weights": {
    "add": {"tag": 0, "manaValue": 0, "staple": 0, "corpus": 0.8, "votes": 0, "role": 0.2},
    "swap": {
      "collection_less": {"tag": 0.4, "manaValue": 0.1, "staple": 0.2, "corpus": 0.2, "votes": 0.1, "role": 0},
      "collection_aware": {"tag": 0.55, "manaValue": 0.1, "staple": 0.1, "corpus": 0.15, "votes": 0.1, "role": 0}
    }
  },
  "corpus": {"synergyScale": 0.3, "synergyShare": 0.6, "baselineWeight": 0.5, "neutralValue": 0.5},
  "swap": {"tagSimilarityFloor": 0.25, "voteHalfWeightCount": 25, "manaValueFalloff": 1.5},
  "cuts": {
    "roleOverloadRatio": 1.25,
    "highManaValue": 6,
    "lowSynergyScore": 0.35,
    "wellPlayedScore": 0.5,
    "optionalCutCap": 0.95,
    "withCorpus": {"corpus": 0.5, "role": 0.3, "manaValue": 0.2},
    "withoutCorpus": {"redundantBase": 0.5, "redundantManaValue": 0.4, "base": 0.3, "manaValue": 0.2}
  }
}$json$::jsonb, false)
on conflict (key) do nothing;

-- Required from here on: the app and the worker refuse to score without them, rather than fall back to numbers in code.
update public.app_config
   set value = value || '{"severeSynergyScore": 0.2}'::jsonb, updated_at = now()
 where key = 'corpus' and not value ? 'severeSynergyScore';
update public.app_config
   set value = value || '{"externalPriorShare": 0}'::jsonb, updated_at = now()
 where key = 'corpus' and not value ? 'externalPriorShare';

-- The stored swap pool's order.
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
  candidate_modes as (
    select distinct ct.card_id, em.group_no, em.mode_id
    from exclusive_modes em
    join (select distinct group_no from target_modes) tg on tg.group_no = em.group_no
    join public.tag_closure tc on tc.ancestor_id = em.mode_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
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
  pool_weights as (
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

-- A request's swap pool, in the same order.
create or replace function public.serving_swap_candidates(
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
  card public.serving_card
)
language sql
stable
security definer
set search_path = ''
as $$
  with target_card as (
    select mana_value from public.cards where id = p_target
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
           (cfg.value #>> '{swap,manaValueFalloff}')::double precision as falloff
    from public.app_config cfg
    where cfg.key = 'scoring'
  ),
  ranked as (
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
      and (p_owned is null or c.id = any (p_owned))
  ),
  picked as materialized (
    select * from ranked where "position" <= p_limit
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
  )
  select p.tag_similarity, p.staple_score, p.is_functional_twin, coalesce(m.matches, '[]'::jsonb),
         coalesce(mt.tags, '[]'::jsonb), r
  from picked p
  left join matched m on m.card_id = p.card_id
  left join match_tags mt on mt.card_id = p.card_id
  join public.serving_cards(p_commander_ids, array(select card_id from picked)) r on r.card_id = p.card_id
  order by p."position"
$$;

-- A pair no key knows: its partners' pool, scored as commanderCorpusScore does.
create or replace function public.serving_partner_pool(
  p_commander_1 integer,
  p_commander_2 integer,
  p_identity_mask smallint,
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[],
  p_limit integer
)
returns table (card_id integer, "position" integer)
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select coalesce((value ->> 'shrinkAlpha')::double precision, 20) as alpha,
           coalesce((value ->> 'partnerPoolWeight')::double precision, 0.25) as weight
    from public.app_config where key = 'corpus'
  ),
  -- commanderCorpusScore's split and synergy scale (app_config.scoring.corpus).
  scoring as (
    select (cfg.value #>> '{corpus,synergyShare}')::double precision as share,
           (cfg.value #>> '{corpus,synergyScale}')::double precision as scale
    from public.app_config cfg
    where cfg.key = 'scoring'
  ),
  sources as (
    select k.color_identity, st.deck_count
    from public.commander_keys k
    join public.commander_stats st on st.commander_key_id = k.id
    where st.deck_count > 0
      and (k.commander_1 in (p_commander_1, p_commander_2) or k.commander_2 in (p_commander_1, p_commander_2))
  ),
  identity_decks as (
    select i.color_identity, coalesce(sum(cfg.weight * src.deck_count), 0) as decks
    from generate_series(0, 31) as i (color_identity)
    cross join cfg
    left join sources src on (i.color_identity & ~src.color_identity::integer) = 0
    group by i.color_identity
  ),
  sums as (
    select t.card_id,
           sum(t.decks_with)::double precision * (select weight from cfg) as decks_with,
           sum(t.too_early)::double precision * (select weight from cfg) as too_early
    from public.partner_card_totals t
    where t.commander_id in (p_commander_1, p_commander_2)
    group by t.card_id
  ),
  scored as (
    select s.card_id, c.name, g.rate::double precision as baseline,
           (s.decks_with + (select alpha from cfg) * g.rate)
             / (greatest(coalesce(d.decks, 0) - s.too_early, s.decks_with) + (select alpha from cfg)) as inclusion
    from sums s
    join public.card_global_stats g on g.card_id = s.card_id
    join public.cards c on c.id = s.card_id
    left join identity_decks d on d.color_identity = c.color_identity
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
  ),
  ranked as (
    select s.card_id, s.name,
           sc.share * (0.5 + 0.5 * greatest(-1, least(1, (s.inclusion - s.baseline) / sc.scale)))
             + (1 - sc.share) * sqrt(least(1, greatest(s.inclusion, 0))) as score
    from scored s
    cross join scoring sc
    order by score desc, s.name
    limit p_limit
  )
  select r.card_id, row_number() over (order by r.score desc, r.name)::integer from ranked r
$$;
