-- Commander pairs as query context (T070). A keyed pair with fewer than minDecks decks of its own borrows every other
-- key either partner leads at partnerPoolWeight (pickCorpusSources), and commander_card_scores held a row for every
-- card any of those keys ran: each partner's decks copied once for every pair it joins, and rewritten whenever a
-- partner's decks changed. 1,027 such pairs held 3.4M of the 5.8M score rows locally (2026-10-08).
--
-- Such a pair is now *derived* (commander_sets.derived). The precompute worker still scores every card for it, but
-- stores only the add pool's order for its first app_config.precompute.pairPoolDepth eligible cards
-- (commander_pair_pool) and its EDHREC page's listings (commander_card_priors). A request works its counts out from
-- facts already stored: the pair's own commander_card_stats row and both partners' partner_card_totals
-- (@mtg/core derivedPairRowSums), so rankings stay what they were.
--
-- Goes out before the worker that writes it: until a scores pass runs with pairPoolDepth set, no set is derived and
-- every read answers as before. pairPoolDepth 0 (or absent) turns derivation off; the next full scores pass puts the
-- stored rows back.

-- === commander_sets.derived ===

alter table public.commander_sets add column if not exists derived boolean not null default false;
comment on column public.commander_sets.derived is
  'A keyed pair under minDecks: its pool order is in commander_pair_pool and its counts are derived per request (T070).';

-- === commander_pair_pool ===

-- A derived pair's add pool: its first pairPoolDepth cards by pool_score among the cards a pool may hold (live,
-- legal, not a basic land, inside the pair's colours), so the deck's own cards and the bracket's Game Changers can be
-- left out and still leave a full pool. No foreign key on card_id, as commander_card_scores has none.
create table if not exists public.commander_pair_pool (
  commander_1 integer not null references public.cards (id) on delete cascade,
  commander_2 integer not null,
  card_id     integer not null,
  -- The add pool's order (@mtg/core addPoolScore), as commander_card_scores.pool_score.
  pool_score  double precision not null,
  primary key (commander_1, commander_2, card_id),
  check (commander_1 < commander_2)
);
create index if not exists commander_pair_pool_order on public.commander_pair_pool (commander_1, commander_2, pool_score desc);

comment on table public.commander_pair_pool is
  'A derived pair''s add pool order, its first pairPoolDepth eligible cards. Written only by the precompute worker (T070).';

-- === commander_card_priors ===

-- A derived pair's EDHREC page: every card it lists, since cuts and swaps read the prior for deck cards outside the
-- pool. Never displayed.
create table if not exists public.commander_card_priors (
  commander_1 integer not null references public.cards (id) on delete cascade,
  commander_2 integer not null,
  card_id     integer not null,
  prior_rate  real not null,
  prior_decks integer not null,
  primary key (commander_1, commander_2, card_id),
  check (commander_1 < commander_2)
);

comment on table public.commander_card_priors is
  'A derived pair''s EDHREC listings: inclusion and potential decks per card (T070). Never displayed.';

-- Only the serving functions (security definer) and the worker read them.
alter table public.commander_pair_pool enable row level security;
alter table public.commander_card_priors enable row level security;
revoke all on public.commander_pair_pool, public.commander_card_priors from anon, authenticated;
grant all on public.commander_pair_pool, public.commander_card_priors to service_role;

-- === settings ===

-- pairPoolDepth: serving_limits.poolCards (400) plus deckCards (250), so a full pool survives the deck's own cards.
update public.app_config
   set value = value || '{"pairPoolDepth": 650}'::jsonb, updated_at = now()
 where key = 'precompute'
   and not value ? 'pairPoolDepth';

-- === serving_card: a derived pair's own counts ===

alter type public.serving_card
  add attribute own_decks_with integer,
  add attribute own_too_early integer;

-- serving_cards: for a derived pair, no stored counts; its own key's counts for the card (0 when the key never ran it),
-- both partners' totals, and the prior from commander_card_priors.
create or replace function public.serving_cards(p_commander_ids integer[], p_card_ids integer[])
returns setof public.serving_card
language sql
stable
security definer
set search_path = ''
set enable_nestloop = on
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  target_set as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           s.commander_1 is not null as known,
           coalesce(s.derived, false) as derived,
           s.edhrec_floor,
           s.edhrec_decks,
           k.id as key_id,
           st.deck_count as key_decks
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
    left join public.commander_keys k on s.derived and k.commander_1 = m.ids[1] and k.commander_2 = m.ids[2]
    left join public.commander_stats st on st.commander_key_id = k.id
  )
  select c.id,
         c.oracle_id, c.name, c.slug, c.mana_value, c.mana_cost, c.type_line, c.color_identity, c.images, c.game_changer,
         c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of, c.legal_commander,
         c.can_be_commander, c.partner_kind, c.partner_qualifier, c.copy_limit, c.is_basic_land, c.artist, c.keywords,
         to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM'),
         g.rate, g.decks_with, g.eligible_decks,
         s.decks_with, s.commander_decks,
         p.decks_with, p.too_early,
         coalesce(r.role_ids, '{}'::uuid[]),
         coalesce(s.prior_rate, pr.prior_rate), coalesce(s.prior_decks, pr.prior_decks), t.edhrec_floor, t.edhrec_decks,
         case when t.derived then coalesce(o.decks_with, 0) end,
         case when t.derived then coalesce(t.key_decks - coalesce(o.eligible_decks, t.key_decks), 0) end
  from (select distinct unnest(p_card_ids) as id) ids
  join public.cards c on c.id = ids.id and c.deleted_at is null
  cross join target_set t
  left join public.card_stats st on st.card_id = c.id
  left join public.card_global_stats g on g.card_id = c.id
  left join public.commander_card_scores s
    on t.known and s.commander_1 = t.c1 and s.commander_2 = t.c2 and s.card_id = c.id
  left join public.commander_card_stats o
    on t.derived and o.commander_key_id = t.key_id and o.card_id = c.id
  left join public.commander_card_priors pr
    on t.derived and pr.commander_1 = t.c1 and pr.commander_2 = t.c2 and pr.card_id = c.id
  left join lateral (
    select sum(pt.decks_with)::integer as decks_with, sum(pt.too_early)::integer as too_early
    from public.partner_card_totals pt
    where (not t.known or t.derived) and t.n = 2 and pt.commander_id in (t.c1, t.c2) and pt.card_id = c.id
  ) p on true
  left join lateral (
    select array_agg(cr.role_id order by cr.role_id) as role_ids from public.card_roles cr where cr.card_id = c.id
  ) r on true
$$;

-- serving_commander_pool: a derived pair's pool comes from commander_pair_pool. A set has rows in only one of the two
-- tables, so both are read and the order is the same.
create or replace function public.serving_commander_pool(
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
set enable_nestloop = on
as $$
  select x.card_id, row_number() over (order by x.pool_score desc, x.name)::integer
  from (
    select s.card_id, s.pool_score, c.name
    from (
      select cs.card_id, cs.pool_score from public.commander_card_scores cs
      where cs.commander_1 = p_commander_1 and cs.commander_2 = p_commander_2
      union all
      select pp.card_id, pp.pool_score from public.commander_pair_pool pp
      where pp.commander_1 = p_commander_1 and pp.commander_2 = p_commander_2
    ) s
    join public.cards c on c.id = s.card_id
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
    order by s.pool_score desc, c.name
    limit p_limit
  ) x
$$;

-- === an index nothing reads ===

-- 0 scans on hosted (2026-10-07): nothing orders a commander's cards by synergy. aggregate:corpus's closing sample sorts
-- one key's few hundred rows.
drop index if exists public.commander_card_stats_synergy;
