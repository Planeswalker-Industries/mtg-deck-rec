-- The precompute worker's serving tables and the reads the request path makes of them (T055,
-- docs/roadmap/card-graph-plan.md "Precompute worker"). A recommendation request reads indexed rows and does small
-- per-deck sums; nothing recomputes play rates or tag similarity while the player waits. The precompute worker
-- (`cli precompute`, scheduled by `cli serve`) is the only writer of every table here.
--
-- Parity first: these reproduce what rec_add_candidates, rec_swap_candidates and rec_card_roles return today, so the
-- switch (app_config.recs.servingReads) changes speed and nothing else. Those functions retire once the serving reads
-- have run on hosted for a week.

-- === commander_card_scores ===

-- One row per commander (or pair) and card some source deck ran, its sources picked by pickCorpusSources: the
-- commander's own key, plus borrowed keys while it has fewer than minDecks decks. Keyed by the commander cards, not
-- by commander_keys, so a commander scores without being a page. A card with no row (no source deck ran it) is scored
-- at request time from card_global_stats and the commander's deck counts (@mtg/core serving.ts).
--
-- No foreign key on card_id: these rows are derived from commander_card_stats and rebuilt from it, every read joins
-- cards, and an index for the key's cascade would cost a fifth of the table (5.1M rows locally, 2026-10-06).
create table public.commander_card_scores (
  commander_1     integer not null references public.cards (id) on delete cascade,
  -- 0 for a single commander, as in corpus.dirty_commanders.
  commander_2     integer not null default 0,
  card_id         integer not null,
  -- Decks that ran the card, each source key at its weight. Double precision, as the request computed it before.
  decks_with      double precision not null,
  -- Decks that could have run it (colours allow it, updated since its release), each key at its weight.
  commander_decks double precision not null,
  -- The add pool's order, as rec_add_candidates computed it (@mtg/core addPoolScore).
  pool_score      double precision not null,
  -- The final corpus component (corpusComponent) and the share of the corpus weight it earned: both null when too few
  -- decks anywhere could have run the card.
  corpus_value    real,
  weight_scale    real,
  primary key (commander_1, commander_2, card_id),
  check (commander_2 = 0 or commander_1 < commander_2)
);
create index commander_card_scores_pool on public.commander_card_scores (commander_1, commander_2, pool_score desc);

comment on table public.commander_card_scores is
  'Per commander (or pair) and card: weighted play counts and the scores built on them. Written only by the precompute worker (T055).';

-- === partner_card_totals ===

-- A commander card's counts over every key it leads or shares, at full weight. A pair no key knows borrows every key
-- of either partner at partnerPoolWeight, and no key holds both, so its counts are the two partners' totals at that
-- weight (@mtg/core partnerRowSums). Only for commanders that appear in a pair or can take a partner.
create table public.partner_card_totals (
  commander_id integer not null references public.cards (id) on delete cascade,
  card_id      integer not null,
  decks_with   integer not null,
  -- Decks among the keys that ran the card that were last updated before it came out.
  too_early    integer not null,
  primary key (commander_id, card_id)
);

-- === commander_sets ===

-- One row per commander (or pair) the scores cover: which pool its requests draw on, decided by the precompute with
-- the app's own rule (pickCorpusSources, commanderShare), so a request's pool read needs nothing read before it.
create table public.commander_sets (
  commander_1   integer not null references public.cards (id) on delete cascade,
  commander_2   integer not null default 0,
  -- Cards to add draw on its decks: the decks that count for it earn its play rates a share of the score.
  use_commander boolean not null,
  -- Any decks count for it at all: the rater and its commander page draw on them whenever they do.
  has_sources   boolean not null,
  primary key (commander_1, commander_2),
  check (commander_2 = 0 or commander_1 < commander_2)
);

-- === card_substitutes ===

-- Per card, the cards that do the same job: idf-weighted functional tag similarity with exclusive tag modes applied,
-- exactly as rec_swap_candidates scores it. The top `substitutesOwn` inside the card's own colour identity (which suit
-- every deck that can hold the card) plus the top `substitutesAll` overall, both by rec_swap_candidates' pool order
-- (app_config.precompute). Legality, Game Changers and colours are applied when read, from cards. No foreign key on
-- substitute_id, for the reason commander_card_scores has none on card_id.
create table public.card_substitutes (
  card_id            integer not null references public.cards (id) on delete cascade,
  substitute_id      integer not null,
  tag_similarity     real not null,
  is_functional_twin boolean not null,
  primary key (card_id, substitute_id)
);

-- What each card's list was built from: a hash of its functional tags and their idf. A card whose hash moved is
-- rebuilt on the next pass; the weekly rebuild catches lists that changed through their candidates.
create table public.substitute_targets (
  card_id   integer primary key references public.cards (id) on delete cascade,
  tags_hash text not null,
  built_at  timestamptz not null default now()
);

-- === card_roles ===

-- Which tracked roles (app_config.deck_role_targets) each card fills through the tag hierarchy, disabled tags left out:
-- what rec_card_roles answered per request.
create table public.card_roles (
  card_id integer not null references public.cards (id) on delete cascade,
  role_id uuid not null references public.tags (id) on delete cascade,
  primary key (card_id, role_id)
);

-- === spellbook_combo_pieces ===

-- Which Commander Spellbook combos each card is a piece of, from corpus.spellbook_combos. Nothing reads it yet: the
-- bracket rules and the combo group (T060) do, and open it to the API roles, crediting and linking Spellbook.
create table public.spellbook_combo_pieces (
  card_id          integer not null references public.cards (id) on delete cascade,
  variant_id       text not null,
  -- Every card in the combo, ascending.
  pieces           integer[] not null,
  -- Pieces that must be the commander.
  commander_pieces integer[] not null default '{}',
  -- Pieces Spellbook names by template ("Legendary Elemental Creature"), which the caller has to match.
  template_pieces  smallint not null default 0,
  min_bracket      smallint not null,
  primary key (card_id, variant_id)
);

-- === precompute_state ===

-- What each precompute part last built from (input versions, the settings it scored with), so a pass whose inputs
-- haven't moved writes nothing.
create table public.precompute_state (
  part       text primary key,
  version    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- === access ===

alter table public.commander_card_scores enable row level security;
alter table public.commander_sets enable row level security;
alter table public.partner_card_totals enable row level security;
alter table public.card_substitutes enable row level security;
alter table public.card_roles enable row level security;
alter table public.spellbook_combo_pieces enable row level security;
alter table public.substitute_targets enable row level security;
alter table public.precompute_state enable row level security;

create policy public_read on public.commander_card_scores for select to anon, authenticated using (true);
create policy public_read on public.partner_card_totals for select to anon, authenticated using (true);
create policy public_read on public.card_substitutes for select to anon, authenticated using (true);
create policy public_read on public.card_roles for select to anon, authenticated using (true);

revoke all on public.commander_card_scores, public.partner_card_totals, public.card_substitutes, public.card_roles,
              public.spellbook_combo_pieces, public.substitute_targets, public.precompute_state, public.commander_sets
  from anon, authenticated;
grant select on public.commander_card_scores, public.partner_card_totals, public.card_substitutes, public.card_roles
  to anon, authenticated;
grant all on public.commander_card_scores, public.partner_card_totals, public.card_substitutes, public.card_roles,
             public.spellbook_combo_pieces, public.substitute_targets, public.precompute_state, public.commander_sets
  to service_role;

-- === indexes the reads and the worker need ===

-- The add pool for a commander with too few decks: cards by baseline, best first.
create index if not exists card_global_stats_rate on public.card_global_stats (rate desc, card_id);
-- A dirty commander's decks, read per key by the precompute worker.
create index if not exists decks_commanders on corpus.decks (commander_card_ids);

-- === settings ===

-- servingReads: the request path reads the serving tables instead of calling the rec functions. Off until the worker
-- has filled them on hosted and the parity script passes there; public, because the app reads it per request.
insert into public.app_config (key, value, is_public) values ('recs', '{"servingReads": false}'::jsonb, true)
on conflict (key) do nothing;

-- substitutesOwn / substitutesAll: how deep each card's lists go. The design's 50 + 50 (card-graph-plan.md) changed 11%
-- of 240 swap lists sampled on 2026-10-06 (the replacement shown came from deeper in today's pool); 220 + 220, the
-- depth of today's shared swap pool, changed none.
insert into public.app_config (key, value) values ('precompute', '{"substitutesOwn": 220, "substitutesAll": 220}'::jsonb)
on conflict (key) do nothing;

-- The schedule: the per-commander pass follows each collation, the baseline runs nightly at baselineHourUtc, and every
-- card's substitutes are rebuilt every substitutesRebuildDays. aggregateEveryHours goes: the full rebuild is now
-- `aggregate:corpus` by hand. Only keys still missing are added, so a tuned value stays.
update public.app_config
   set value = (value - 'aggregateEveryHours')
               || case when value ? 'baselineHourUtc' then '{}'::jsonb else '{"baselineHourUtc": 4}'::jsonb end
               || case when value ? 'substitutesRebuildDays' then '{}'::jsonb else '{"substitutesRebuildDays": 7}'::jsonb end,
       updated_at = now()
 where key = 'worker'
   and (value ? 'aggregateEveryHours' or not value ? 'baselineHourUtc' or not value ? 'substitutesRebuildDays');

-- === reads ===

-- Every read a recommendation makes goes out in one round (T055): nothing here waits on another call's answer. The
-- functions take the deck's commander ids and work out the rest themselves (the commander set, its colours, which pool
-- it draws on), and every card comes back as one serving_card row: the card itself, its stored counts for those
-- commanders, its baseline and its roles. The app scores those rows with the same @mtg/core code as before.

-- One card as a recommendation request needs it.
create type public.serving_card as (
  card_id                 integer,
  -- The columns fetchCardsById reads (apps/web lib/server/cards.ts CARD_COLUMNS), so a row becomes a CardRow as is.
  oracle_id               uuid,
  name                    text,
  slug                    text,
  mana_value              real,
  mana_cost               text,
  type_line               text,
  color_identity          smallint,
  images                  jsonb,
  game_changer            boolean,
  released_at             date,
  reference_price_usd     numeric(10,2),
  reference_price_finish  text,
  prices_as_of            timestamptz,
  legal_commander         text,
  can_be_commander        boolean,
  partner_kind            text,
  partner_qualifier       text,
  copy_limit              smallint,
  is_basic_land           boolean,
  artist                  text,
  keywords                text[],
  -- 'YYYY-MM' of the first printing (cards.released_at dates the representative, often latest, printing).
  release_month           text,
  -- card_global_stats; null when no deck runs the card.
  baseline_rate           real,
  baseline_decks_with     integer,
  baseline_eligible_decks integer,
  -- commander_card_scores for these commanders; null when no source deck ran the card.
  decks_with              double precision,
  commander_decks         double precision,
  -- For a pair no key knows: both partners' partner_card_totals summed, at full weight (the app applies the weight).
  partner_decks_with      integer,
  partner_too_early       integer,
  -- card_roles: the tracked roles the card fills.
  role_ids                uuid[]
);

-- These cards for these commanders. The commander set is the sorted commander ids; it is "known" when the precompute
-- scored it (commander_sets), otherwise a pair's counts come from its partners' totals. Soft-deleted cards are left out,
-- as fetchCardsById leaves them out. enable_nestloop on: a few hundred primary-key lookups, which a caller's own
-- setting must not turn into hash joins over whole tables.
create function public.serving_cards(p_commander_ids integer[], p_card_ids integer[])
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
           exists (
             select 1 from public.commander_sets s
             where s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
           ) as known
    from commanders m
  )
  select c.id,
         c.oracle_id, c.name, c.slug, c.mana_value, c.mana_cost, c.type_line, c.color_identity, c.images, c.game_changer,
         c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of, c.legal_commander,
         c.can_be_commander, c.partner_kind, c.partner_qualifier, c.copy_limit, c.is_basic_land, c.artist, c.keywords,
         to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM'),
         g.rate, g.decks_with, g.eligible_decks,
         s.decks_with, s.commander_decks,
         p.decks_with, p.too_early,
         coalesce(r.role_ids, '{}'::uuid[])
  from (select distinct unnest(p_card_ids) as id) ids
  join public.cards c on c.id = ids.id and c.deleted_at is null
  cross join target_set t
  left join public.card_stats st on st.card_id = c.id
  left join public.card_global_stats g on g.card_id = c.id
  left join public.commander_card_scores s
    on t.known and s.commander_1 = t.c1 and s.commander_2 = t.c2 and s.card_id = c.id
  left join lateral (
    select sum(pt.decks_with)::integer as decks_with, sum(pt.too_early)::integer as too_early
    from public.partner_card_totals pt
    where not t.known and t.n = 2 and pt.commander_id in (t.c1, t.c2) and pt.card_id = c.id
  ) p on true
  left join lateral (
    select array_agg(cr.role_id order by cr.role_id) as role_ids from public.card_roles cr where cr.card_id = c.id
  ) r on true
$$;

-- The commander's (or pair's) own pool: its cards by rec_add_candidates' order, under the deck's filters. Legality,
-- Game Changers and colours come from cards (cards_rec_pool), so they are always current. Internal: serving_add_pool
-- calls it.
create function public.serving_commander_pool(
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
    from public.commander_card_scores s
    join public.cards c on c.id = s.card_id
    where s.commander_1 = p_commander_1
      and s.commander_2 = p_commander_2
      and c.deleted_at is null
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

-- The colours' most played cards, for a commander with too few decks of its own (rec_add_candidates with no sources
-- ordered by the square root of the baseline, which keeps the same order). Internal.
--
-- enable_nestloop off, as the rec functions have it: the plan can't see the colours it is asked for, and chose a nested
-- loop over every card for every baseline row it read (0.4-1.2 s locally). A hash join over both tables takes ~12 ms.
create function public.serving_baseline_pool(
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
set enable_nestloop = off
as $$
  select x.card_id, row_number() over (order by x.rate desc, x.name)::integer
  from (
    select g.card_id, g.rate, c.name
    from public.card_global_stats g
    join public.cards c on c.id = g.card_id
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
    order by g.rate desc, c.name
    limit p_limit
  ) x
$$;

-- A pair no key knows: every key either partner leads or shares is borrowed at partnerPoolWeight (pickCorpusSources
-- with no key of their own), so its counts are the partners' totals at that weight, scored as rec_add_candidates scored
-- borrowed sources. Its decks per colour identity are summed here from the same keys; the constants are
-- commanderCorpusScore's (synergy scale 0.3, a 60/40 split), as in rec_add_candidates. Internal.
create function public.serving_partner_pool(
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
           0.6 * (0.5 + 0.5 * greatest(-1, least(1, (s.inclusion - s.baseline) / 0.3))) + 0.4 * sqrt(least(1, greatest(s.inclusion, 0))) as score
    from scored s
    order by score desc, s.name
    limit p_limit
  )
  select r.card_id, row_number() over (order by r.score desc, r.name)::integer from ranked r
$$;

-- Cards to add (and the rater's and commander pages' pools) for these commanders, every card a serving_card. Which pool:
-- * a commander set the precompute scored draws on its own decks when commander_sets says so: for adds once they earn a
--   share of the score (use_commander), for the rater and pages whenever any decks count (has_sources, p_mode 'decks');
-- * otherwise the colours' most played cards;
-- * a pair no key knows gets both its partners' pool and the colours' pool, marked by `pool`: the app knows its corpus
--   in the same round and picks with its own rule, so that rule never has to be copied in here.
create function public.serving_add_pool(
  p_commander_ids integer[],
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 400,
  p_mode text default 'adds'
)
returns table (pool text, "position" integer, card public.serving_card)
language sql
stable
security definer
set search_path = ''
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  t as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           coalesce((select bit_or(c.color_identity) from public.cards c where c.id = any (m.ids) and c.deleted_at is null), 0)::smallint as mask,
           s.commander_1 is not null as known,
           coalesce(case when p_mode = 'decks' then s.has_sources else s.use_commander end, false) as draw
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
  ),
  pools as materialized (
    select 'commander'::text as pool, p.card_id, p."position"
    from t
    cross join lateral public.serving_commander_pool(t.c1, t.c2, t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where t.known and t.draw
    union all
    select 'partners'::text, p.card_id, p."position"
    from t
    cross join lateral public.serving_partner_pool(t.c1, t.c2, t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where not t.known and t.n = 2
    union all
    select 'baseline'::text, p.card_id, p."position"
    from t
    cross join lateral public.serving_baseline_pool(t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where not (t.known and t.draw)
  )
  select p.pool, p."position", r
  from pools p
  join public.serving_cards(p_commander_ids, array(select distinct card_id from pools)) r on r.card_id = p.card_id
  order by p.pool, p."position"
$$;

-- Replacement candidates for a card: its stored substitutes under the deck's filters, in rec_swap_candidates' pool
-- order, with the tag matches that explain each one (and those tags' names, so the app needs no second read), every
-- candidate a serving_card for these commanders. The colours are the commanders' unless p_identity_mask says otherwise
-- (a card page passes the card's own). Matches are worked out for the candidates returned, never stored, by
-- rec_swap_candidates' pair rule.
--
-- The mana value term's exponent stops at -700 here and in precompute_substitutes: Postgres raises an error where exp()
-- underflows, which Gleemax (mana value 1,000,000) did as a target. No real gap comes near it (exp(-700) is 1e-304),
-- so the order is rec_swap_candidates' for every other card.
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
  ranked as (
    select s.substitute_id as card_id,
           s.tag_similarity,
           s.is_functional_twin,
           coalesce(st.staple_score, 0)::real as staple_score,
           row_number() over (
             order by s.is_functional_twin desc,
                      (0.4 * s.tag_similarity
                        + 0.2 * coalesce(st.staple_score, 0)
                        + 0.1 * exp(greatest(-abs(c.mana_value - coalesce((select mana_value from target_card), c.mana_value)) / 1.5, -700))) desc,
                      c.name
           ) as "position"
    from public.card_substitutes s
    join public.cards c on c.id = s.substitute_id
    left join public.card_stats st on st.card_id = s.substitute_id
    cross join colours
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

-- === the precompute worker's similarity ===

-- One card's substitutes for card_substitutes: rec_swap_candidates' similarity over every live, legal, non-basic card
-- (no deck, no colours, Game Changers included), then the top p_all by its pool order plus the top p_own inside the
-- card's own colour identity. Keep the scoring in step with rec_swap_candidates until that function retires.
create function public.precompute_substitutes(p_target integer, p_own integer, p_all integer)
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
    select c.id, c.name, c.mana_value, c.equivalence_base_id, c.color_identity
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
  ranked as (
    select x.card_id,
           x.tag_similarity,
           x.is_functional_twin,
           (e.color_identity & ~(select color_identity from target_card)) = 0 as in_own_identity,
           row_number() over (
             order by x.is_functional_twin desc,
                      (0.4 * x.tag_similarity
                        + 0.2 * coalesce(st.staple_score, 0)
                        + 0.1 * exp(greatest(-abs(e.mana_value - coalesce((select mana_value from target_card), e.mana_value)) / 1.5, -700))) desc,
                      e.name
           ) as rank_all
    from combined x
    join eligible e on e.id = x.card_id
    left join public.card_stats st on st.card_id = x.card_id
  ),
  grouped as (
    select r.*, row_number() over (partition by r.in_own_identity order by r.rank_all) as rank_in_group
    from ranked r
  )
  select g.card_id, g.tag_similarity, g.is_functional_twin
  from grouped g
  where g.rank_all <= p_all or (g.in_own_identity and g.rank_in_group <= p_own)
$$;

revoke execute on function public.serving_cards(integer[], integer[]) from public;
revoke execute on function public.serving_commander_pool(integer, integer, smallint, integer[], boolean, integer[], integer) from public;
revoke execute on function public.serving_baseline_pool(smallint, integer[], boolean, integer[], integer) from public;
revoke execute on function public.serving_partner_pool(integer, integer, smallint, integer[], boolean, integer[], integer) from public;
revoke execute on function public.serving_add_pool(integer[], integer[], boolean, integer[], integer, text) from public;
revoke execute on function public.serving_swap_candidates(integer, integer[], integer[], boolean, integer[], integer, smallint) from public;
revoke execute on function public.precompute_substitutes(integer, integer, integer) from public;

-- The three pools are internal: serving_add_pool calls them as their owner.
grant execute on function public.serving_cards(integer[], integer[]) to anon, authenticated, service_role;
grant execute on function public.serving_add_pool(integer[], integer[], boolean, integer[], integer, text)
  to anon, authenticated, service_role;
grant execute on function public.serving_swap_candidates(integer, integer[], integer[], boolean, integer[], integer, smallint)
  to anon, authenticated, service_role;
grant execute on function public.precompute_substitutes(integer, integer, integer) to service_role;
