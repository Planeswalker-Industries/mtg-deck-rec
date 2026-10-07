-- Card pairs and deck affinity (T064; docs/roadmap/card-graph-plan.md, "Statistics" and "Deck affinity").
--
-- * commander_card_pairs: per commander key, the pairs of cards its decks run together more than chance would have
--   them (card_a < card_b), with the decks running both and the lift, shrunk toward 1. Written by the precompute
--   worker for the keys whose stats moved (`precompute --part pairs`).
-- * card_pairs: the same over the whole corpus, counted weekly, for commanders with few decks of their own.
-- * app_config.pairs (private): how pairs are counted and pruned. The lift floor starts at 1.5 (owner decision
--   2026-10-06): 4.4M rows estimated, against 10.7M at 1.2.
-- * app_config.scoring: the `deck` component, and `affinity` (the backoff, the score's half point, LOW_AFFINITY off).
--   Adds weigh it 0.1 (corpus 0.8 → 0.7): on the time split (2026-10-06) adds recall@20 rose 25.0% → 25.5% (+0.53
--   points, 95% interval +0.30 to +0.80), every size bucket rose and collection recall rose 49.5% → 51.3%. At 0.2 recall
--   was flat. Swaps keep it at 0 until the evaluation grades swaps.
-- * serving_deck_affinity(): the pairs touching a deck's cards, its cards' weights and the cards its pairs point to
--   (each a serving_card), as one jsonb value, read with a request's other reads.

create table if not exists public.commander_card_pairs (
  commander_1 integer not null,
  commander_2 integer not null default 0,
  card_a      integer not null references public.cards (id) on delete cascade,
  card_b      integer not null references public.cards (id) on delete cascade,
  pair_decks  integer not null,
  lift        real not null,
  primary key (commander_1, commander_2, card_a, card_b),
  check (card_a < card_b)
);
create index if not exists commander_card_pairs_card_b on public.commander_card_pairs (commander_1, commander_2, card_b);

create table if not exists public.card_pairs (
  card_a     integer not null references public.cards (id) on delete cascade,
  card_b     integer not null references public.cards (id) on delete cascade,
  pair_decks integer not null,
  lift       real not null,
  primary key (card_a, card_b),
  check (card_a < card_b)
);
create index if not exists card_pairs_card_b on public.card_pairs (card_b);

alter table public.commander_card_pairs enable row level security;
alter table public.card_pairs enable row level security;
revoke all on public.commander_card_pairs, public.card_pairs from anon, authenticated;
grant all on public.commander_card_pairs, public.card_pairs to service_role;

insert into public.app_config (key, value, is_public)
values (
  'pairs',
  '{"shrinkAlpha": 10, "minSupport": 5, "minShare": 0.05, "liftFloor": 1.5, "maxPartners": 50, "globalMinDecks": 50}'::jsonb,
  false
)
on conflict (key) do nothing;

update public.app_config
   set value = jsonb_set(
                 jsonb_set(
                   jsonb_set(
                     jsonb_set(value, '{weights,add,deck}', '0.1'::jsonb),
                     '{weights,add,corpus}', '0.7'::jsonb),
                   '{weights,swap,collection_less,deck}', '0'::jsonb),
                 '{weights,swap,collection_aware,deck}', '0'::jsonb)
               || '{"affinity": {"backoffBeta": 50, "halfValue": 0.1, "lowAffinityScore": 0.2, "lowAffinityCuts": false, "neighbours": 100}}'::jsonb,
       updated_at = now()
 where key = 'scoring'
   and not value ? 'affinity';

-- The worker recounts the corpus's pairs this often.
update public.app_config
   set value = value || '{"globalPairsEveryDays": 7}'::jsonb, updated_at = now()
 where key = 'worker'
   and not value ? 'globalPairsEveryDays';

-- The pairs touching a deck's cards (`own`: the exact commander set's key, `global`: the corpus's) as [card_a, card_b,
-- lift]; each deck card's weight (`cards`: [card, p̂(card | key) or its colour baseline, the key's decks running it]);
-- and `neighbours`: the serving_cards of the p_neighbours cards (app_config.scoring.affinity.neighbours when null)
-- outside the deck that its pairs point to most (summed ln(lift), the key's pair where there is one), inside the
-- commanders' colours, legal, not left out, Game Changers per the bracket.
create or replace function public.serving_deck_affinity(
  p_commander_ids integer[],
  p_card_ids integer[],
  p_exclude integer[] default '{}',
  p_allow_game_changers boolean default true,
  p_neighbours integer default null
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
  wanted as (
    select coalesce(p_neighbours, (select (value -> 'affinity' ->> 'neighbours')::integer from public.app_config where key = 'scoring'), 0) as n
  ),
  target as materialized (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           coalesce((select bit_or(c.color_identity) from public.cards c where c.id = any (m.ids) and c.deleted_at is null), 0)::smallint as mask,
           (select k.id from public.commander_keys k
             where k.commander_1 = m.ids[1] and coalesce(k.commander_2, 0) = coalesce(m.ids[2], 0)) as key_id
    from commanders m
  ),
  deck as materialized (
    select distinct x as card_id from unnest(coalesce(p_card_ids, '{}'::integer[])) as x
  ),
  own as materialized (
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p
    join target t on p.commander_1 = t.c1 and p.commander_2 = t.c2
    join deck d on d.card_id = p.card_a
    union
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p
    join target t on p.commander_1 = t.c1 and p.commander_2 = t.c2
    join deck d on d.card_id = p.card_b
  ),
  glob as materialized (
    select p.card_a, p.card_b, p.lift from public.card_pairs p join deck d on d.card_id = p.card_a
    union
    select p.card_a, p.card_b, p.lift from public.card_pairs p join deck d on d.card_id = p.card_b
  ),
  weights as (
    select d.card_id, coalesce(s.inclusion_shrunk, g.rate, 0)::real as rate, coalesce(s.decks_with, 0) as key_decks
    from deck d
    cross join target t
    left join public.commander_card_stats s on s.commander_key_id = t.key_id and s.card_id = d.card_id
    left join public.card_global_stats g on g.card_id = d.card_id
  ),
  links as (
    -- Each pair from the deck card's side: the other card, and ln(lift) from the key's table (0) or the corpus's (1).
    select case when exists (select 1 from deck d where d.card_id = x.card_a) then x.card_b else x.card_a end as other,
           ln(x.lift) as pmi,
           x.source
    from (select card_a, card_b, lift, 0 as source from own union all select card_a, card_b, lift, 1 from glob) x
  ),
  strongest as (
    -- A card the key's pairs know is read from them; otherwise from the corpus's.
    select l.other,
           case when bool_or(l.source = 0) then sum(l.pmi) filter (where l.source = 0) else sum(l.pmi) end as strength
    from links l
    where not exists (select 1 from deck d where d.card_id = l.other)
    group by l.other
  ),
  neighbours as materialized (
    select s.other as card_id, row_number() over (order by s.strength desc, s.other) as rank
    from strongest s
    join public.cards card on card.id = s.other
    cross join target t
    cross join wanted w
    where w.n > 0
      and card.deleted_at is null
      and card.legal_commander = 'legal'
      and not card.is_basic_land
      and (card.color_identity & ~t.mask) = 0
      and card.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not card.game_changer)
    order by s.strength desc, s.other
    limit (select greatest(n, 0) from wanted)
  )
  select jsonb_build_object(
    'own', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from own), '[]'::jsonb),
    'global', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from glob), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(card_id, rate, key_decks)) from weights), '[]'::jsonb),
    'neighbours', coalesce(
      (select jsonb_agg(to_jsonb(r) order by n.rank)
         from public.serving_cards(p_commander_ids, array(select card_id from neighbours)) r
         join neighbours n on n.card_id = r.card_id),
      '[]'::jsonb)
  )
$$;

revoke all on function public.serving_deck_affinity(integer[], integer[], integer[], boolean, integer) from public;
grant execute on function public.serving_deck_affinity(integer[], integer[], integer[], boolean, integer)
  to anon, authenticated, service_role;
