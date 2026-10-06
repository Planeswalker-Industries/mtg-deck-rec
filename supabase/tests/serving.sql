-- The serving tables and the reads the request path makes of them (T055): what the API roles may read and run, that
-- each read works out the commander set itself (its pool, its colours, its counts), applies the deck's filters
-- (colours, legality, Game Changers, cards in the deck, owned only) in the old functions' order, and returns each card
-- whole, and that the precompute worker's similarity is rec_swap_candidates'. Runs in a transaction and rolls back, so
-- it leaves nothing behind. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;
grant execute on function chk(text, boolean, text) to anon, authenticated, service_role;
create or replace function must_fail(p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into t values (p_name, false, 'no error raised');
exception when others then
  insert into t values (p_name, sqlerrm ilike '%' || p_expect || '%', sqlerrm);
end $$;
grant execute on function must_fail(text, text, text) to anon, authenticated, service_role;

-- Thrasios (G/U) and Tymna (W/B): mask 23. The other cards are the most played of their kind (a baseline row is what
-- the partner pool joins on), picked by their flags so a catalog update can't turn a fixture into a Game Changer.
-- `lonely` is a commander the precompute has no set for, so its requests draw on its colours' most played cards.
create temp view played as
  select c.id, c.color_identity, c.game_changer, c.legal_commander, g.rate
  from public.card_global_stats g
  join public.cards c on c.id = g.card_id
  where c.deleted_at is null and not c.is_basic_land;
select
  (select id from public.cards where deleted_at is null and name = 'Thrasios, Triton Hero') as thrasios,
  (select id from public.cards where deleted_at is null and name = 'Tymna the Weaver') as tymna,
  (select id from played where legal_commander = 'legal' and not game_changer and color_identity = 0 order by rate desc, id limit 1) as plain,
  (select id from played where legal_commander = 'legal' and not game_changer and color_identity = 2 order by rate desc, id limit 1) as blue1,
  (select id from played where legal_commander = 'legal' and not game_changer and color_identity = 2 order by rate desc, id offset 1 limit 1) as blue2,
  (select id from played where legal_commander = 'legal' and not game_changer and color_identity = 8 order by rate desc, id limit 1) as red,
  (select id from played where legal_commander = 'legal' and not game_changer and color_identity = 1 order by rate desc, id limit 1) as white,
  (select id from played where legal_commander = 'legal' and game_changer and (color_identity & ~23) = 0 order by rate desc, id limit 1) as changer,
  (select min(id) from public.cards where deleted_at is null and legal_commander = 'banned' and (color_identity & ~23) = 0) as banned,
  (select min(c.id) from public.cards c
    where c.deleted_at is null and c.can_be_commander and c.color_identity = 2
      and not exists (select 1 from public.commander_sets s where s.commander_1 = c.id and s.commander_2 = 0)) as lonely,
  (select min(card_id) from public.card_roles) as with_roles
\gset
select chk('fixtures resolve', :thrasios is not null and :tymna is not null and :plain is not null and :blue1 is not null
  and :blue2 is not null and :blue1 <> :blue2 and :red is not null and :white is not null and :changer is not null
  and :banned is not null and :lonely is not null and :with_roles is not null);
select least(:thrasios, :tymna) as c1, greatest(:thrasios, :tymna) as c2 \gset

-- === the add pool ===
delete from public.commander_sets where commander_1 = :c1 and commander_2 = :c2;
insert into public.commander_sets (commander_1, commander_2, use_commander, has_sources) values (:c1, :c2, true, true);
delete from public.commander_card_scores where commander_1 = :c1 and commander_2 = :c2;
insert into public.commander_card_scores (commander_1, commander_2, card_id, decks_with, commander_decks, pool_score, corpus_value, weight_scale)
values (:c1, :c2, :plain, 10, 20, 0.9, 0.8, 1),
       (:c1, :c2, :blue1, 5, 20, 0.7, 0.6, 1),
       (:c1, :c2, :red, 5, 20, 0.95, 0.6, 1),
       (:c1, :c2, :changer, 5, 20, 0.8, 0.6, 1),
       (:c1, :c2, :banned, 5, 20, 0.99, 0.6, 1);

select chk('a scored commander set draws on its own cards only, best first, in its colours and legal',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:thrasios, :tymna], '{}', true, null, 10))
    = array[:plain, :changer, :blue1]
  and (select bool_and(pool = 'commander') from public.serving_add_pool(array[:thrasios, :tymna], '{}', true, null, 10)));
select chk('the commanders may come in any order, and twice',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:tymna, :thrasios, :tymna], '{}', true, null, 10))
    = array[:plain, :changer, :blue1]);
select chk('Game Changers stay out when the bracket allows none',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:c1, :c2], '{}', false, null, 10)) = array[:plain, :blue1]);
select chk('cards in the deck stay out',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:c1, :c2], array[:plain], true, null, 10)) = array[:changer, :blue1]);
select chk('owned only keeps to the collection',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:c1, :c2], '{}', true, array[:blue1], 10)) = array[:blue1]);
select chk('the pool stops at its limit',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 1)) = array[:plain]);
select chk('each pool card comes whole, with the commanders'' stored counts',
  (select (card).decks_with = 10 and (card).commander_decks = 20 and (card).name = c.name and (card).slug = c.slug
          and (card).type_line = c.type_line and (card).color_identity = c.color_identity and (card).partner_decks_with is null
     from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10) p
     join public.cards c on c.id = (p.card).card_id
     where (p.card).card_id = :plain));

update public.commander_sets set use_commander = false where commander_1 = :c1 and commander_2 = :c2;
select chk('a set whose decks earn no share yet gives adds its colours'' most played cards',
  (select bool_and(pool = 'baseline') and count(*) = 10 from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10)));
select chk('while the rater and its pages still draw on the decks that count',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10, 'decks'))
    = array[:plain, :changer, :blue1]);

select chk('a commander with no scored set draws on the most played cards in its colours',
  (select array_agg((card).card_id order by "position") from public.serving_add_pool(array[:lonely], array[:lonely], true, null, 20))
  = (select array_agg(card_id order by rate desc, name)
       from (select g.card_id, g.rate, c.name from public.card_global_stats g join public.cards c on c.id = g.card_id
             where c.deleted_at is null and c.legal_commander = 'legal' and not c.is_basic_land and (c.color_identity & ~2) = 0
               and c.id <> :lonely
             order by g.rate desc, c.name limit 20) g));
select chk('and only that pool',
  (select bool_and(pool = 'baseline') from public.serving_add_pool(array[:lonely], '{}', true, null, 20)));

-- === a pair no key knows ===
delete from public.commander_sets where commander_1 = :c1 and commander_2 = :c2;
delete from public.partner_card_totals where commander_id in (:thrasios, :tymna);
insert into public.partner_card_totals (commander_id, card_id, decks_with, too_early)
values (:thrasios, :plain, 30, 0), (:tymna, :plain, 10, 0), (:thrasios, :blue1, 1, 0), (:tymna, :red, 9, 0);
select chk('a pair no key knows gets its partners'' cards inside the pair''s colours, and the colours'' pool beside them',
  (select array_agg((card).card_id order by "position") filter (where pool = 'partners')
     from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10)) = array[:plain, :blue1]
  and (select count(*) filter (where pool = 'baseline') = 10 and count(*) filter (where pool = 'commander') = 0
         from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10)));
select chk('its cards carry both partners'' totals at full weight, and no stored counts',
  (select (card).partner_decks_with = 40 and (card).partner_too_early = 0 and (card).decks_with is null
     from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 10) where pool = 'partners' and (card).card_id = :plain));

-- === cards ===
insert into public.commander_sets (commander_1, commander_2, use_commander, has_sources) values (:c1, :c2, true, true);
select chk('a card carries the commanders'' stored counts',
  (select decks_with = 10 and commander_decks = 20 and color_identity = 0 and partner_decks_with is null
     from public.serving_cards(array[:c1, :c2], array[:plain])));
select chk('a card no source deck ran comes back without counts, with its colours',
  (select decks_with is null and commander_decks is null and color_identity = 2 from public.serving_cards(array[:c1, :c2], array[:blue2])));
select chk('one row per card asked for',
  (select count(*) = 2 from public.serving_cards(array[:c1, :c2], array[:plain, :plain, :blue1])));
select chk('a card carries what fetchCardsById reads, its first printing''s month and its baseline',
  (select s.name = c.name and s.oracle_id = c.oracle_id and s.mana_value = c.mana_value and s.images = c.images
          and s.legal_commander = c.legal_commander and s.can_be_commander = c.can_be_commander
          and s.release_month = to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM')
          and s.baseline_rate = g.rate and s.baseline_decks_with = g.decks_with and s.baseline_eligible_decks = g.eligible_decks
     from public.serving_cards(array[:c1, :c2], array[:plain]) s
     join public.cards c on c.id = s.card_id
     left join public.card_stats st on st.card_id = c.id
     join public.card_global_stats g on g.card_id = c.id));
select chk('a card carries its roles',
  (select role_ids = (select array_agg(role_id order by role_id) from public.card_roles where card_id = :with_roles)
     from public.serving_cards('{}', array[:with_roles])));
select chk('a single commander nobody scored has no partner totals',
  (select decks_with is null and partner_decks_with is null from public.serving_cards(array[:lonely], array[:plain])));
update public.cards set deleted_at = now() where id = :blue2;
select chk('soft-deleted cards are left out',
  (select count(*) = 0 from public.serving_cards(array[:c1, :c2], array[:blue2])));
update public.cards set deleted_at = null where id = :blue2;

-- === substitutes ===
delete from public.card_substitutes where card_id = :blue1;
insert into public.card_substitutes (card_id, substitute_id, tag_similarity, is_functional_twin)
values (:blue1, :blue2, 0.5, false), (:blue1, :plain, 0.4, true), (:blue1, :red, 0.9, false), (:blue1, :white, 0.9, false),
       (:blue1, :banned, 0.9, false);
select chk('substitutes come twin first, in the colours asked for and legal',
  (select array_agg((card).card_id) from public.serving_swap_candidates(:blue1, '{}', '{}', true, null, 10, 2::smallint)) = array[:plain, :blue2]);
select chk('cards in the deck stay out of the substitutes',
  (select array_agg((card).card_id) from public.serving_swap_candidates(:blue1, '{}', array[:plain], true, null, 10, 2::smallint)) = array[:blue2]);
select chk('without a mask the colours are the commanders''',
  (select array_agg((card).card_id) from public.serving_swap_candidates(:blue1, array[:thrasios, :tymna], '{}', true, null, 10))
    @> array[:plain, :blue2, :white]
  and not (select array_agg((card).card_id) from public.serving_swap_candidates(:blue1, array[:thrasios, :tymna], '{}', true, null, 10))
    @> array[:red]);
select chk('and colourless with no commanders',
  (select array_agg((card).card_id) from public.serving_swap_candidates(:blue1, '{}', '{}', true, null, 10)) = array[:plain]);
select chk('each substitute comes whole, with the commanders'' counts',
  (select (card).decks_with = 10 and (card).name is not null
     from public.serving_swap_candidates(:blue1, array[:c1, :c2], '{}', true, null, 10) where (card).card_id = :plain));

-- Counterspell's list rebuilt the way the worker builds it, then read the way a request reads it.
select (select id from public.cards where deleted_at is null and name = 'Counterspell') as counterspell \gset
delete from public.card_substitutes where card_id = :counterspell;
insert into public.card_substitutes (card_id, substitute_id, tag_similarity, is_functional_twin)
select :counterspell, card_id, tag_similarity, is_functional_twin
from public.precompute_substitutes(:counterspell, 220, 220);
select chk('the stored similarity is rec_swap_candidates''',
  not exists (
    select 1
    from public.rec_swap_candidates(:counterspell, '{}', 31::smallint, true, null, 40) o
    left join public.precompute_substitutes(:counterspell, 40, 40) n on n.card_id = o.card_id
    where n.card_id is null or n.tag_similarity <> o.tag_similarity or n.is_functional_twin <> o.is_functional_twin
  ));
select chk('and the card''s own colours get their own list',
  not exists (
    select 1
    from public.rec_swap_candidates(:counterspell, '{}', 2::smallint, true, null, 40) o
    where o.card_id not in (select card_id from public.precompute_substitutes(:counterspell, 40, 1))
  ));
select chk('read back, the stored list is rec_swap_candidates'' list: same cards, order, scores and matches',
  (select array_agg(row(card_id, tag_similarity, staple_score, is_functional_twin, matches)::text order by ord)
     from public.rec_swap_candidates(:counterspell, '{}', 23::smallint, true, null, 60) with ordinality as o (card_id, tag_similarity, staple_score, is_functional_twin, matches, ord))
  = (select array_agg(row((card).card_id, tag_similarity, staple_score, is_functional_twin, matches)::text order by ord)
     from public.serving_swap_candidates(:counterspell, array[:thrasios, :tymna], '{}', true, null, 60) with ordinality as s (tag_similarity, staple_score, is_functional_twin, matches, match_tags, card, ord)));
select chk('every tag a match names comes with its slug and label',
  not exists (
    select 1
    from public.serving_swap_candidates(:counterspell, array[:thrasios, :tymna], '{}', true, null, 60) s
    cross join lateral jsonb_array_elements(s.matches) m
    cross join lateral (values (m ->> 'targetTagId'), (m ->> 'candidateTagId'), (m ->> 'viaTagId')) as v (tag_id)
    where v.tag_id is not null
      and not exists (
        select 1 from jsonb_array_elements(s.match_tags) mt
        where mt ->> 'id' = v.tag_id and mt ->> 'slug' is not null and mt ->> 'label' is not null
      )
  )
  and (select count(*) > 0 from public.serving_swap_candidates(:counterspell, array[:thrasios, :tymna], '{}', true, null, 60) where matches <> '[]'));

-- === access ===
set local role anon;
select chk('anon reads scores, partner totals, substitutes and roles',
  (select count(*) >= 0 from public.commander_card_scores where commander_1 = :c1)
  and (select count(*) >= 0 from public.partner_card_totals where commander_id = :thrasios)
  and (select count(*) >= 0 from public.card_substitutes where card_id = :blue1)
  and (select count(*) >= 0 from public.card_roles where card_id = :blue1));
select chk('anon runs the serving reads',
  (select count(*) > 0 from public.serving_add_pool(array[:c1, :c2], '{}', true, null, 1))
  and (select count(*) > 0 from public.serving_cards(array[:c1, :c2], array[:plain]))
  and (select count(*) > 0 from public.serving_swap_candidates(:blue1, array[:c1, :c2], '{}', true, null, 10)));
select must_fail('anon cannot read the commander sets', 'select count(*) from public.commander_sets', 'permission denied');
select must_fail('anon cannot run the commander pool on its own',
  format('select count(*) from public.serving_commander_pool(%s, %s, 23::smallint, ''{}'', true, null, 1)', :c1, :c2), 'permission denied');
select must_fail('anon cannot run the baseline pool on its own',
  'select count(*) from public.serving_baseline_pool(31::smallint, ''{}'', true, null, 1)', 'permission denied');
select must_fail('anon cannot run the partner pool on its own',
  format('select count(*) from public.serving_partner_pool(%s, %s, 23::smallint, ''{}'', true, null, 1)', :c1, :c2), 'permission denied');
select must_fail('anon cannot write scores', 'delete from public.commander_card_scores', 'permission denied');
select must_fail('anon cannot write substitutes', 'delete from public.card_substitutes', 'permission denied');
select must_fail('anon cannot read combo pieces before T060 opens them', 'select count(*) from public.spellbook_combo_pieces', 'permission denied');
select must_fail('anon cannot read the precompute state', 'select count(*) from public.precompute_state', 'permission denied');
select must_fail('anon cannot read the substitute build state', 'select count(*) from public.substitute_targets', 'permission denied');
select must_fail('anon cannot run the precompute similarity', 'select count(*) from public.precompute_substitutes(1, 1, 1)', 'permission denied');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot write roles', 'delete from public.card_roles', 'permission denied');
select must_fail('a signed-in user cannot read the commander sets', 'select count(*) from public.commander_sets', 'permission denied');
reset role;
set local role service_role;
select chk('service_role reads combo pieces, commander sets and the precompute state',
  (select count(*) >= 0 from public.spellbook_combo_pieces) and (select count(*) >= 0 from public.commander_sets)
  and (select count(*) >= 0 from public.precompute_state));
reset role;

-- === settings ===
select chk('the serving reads switch exists and the app may read it',
  (select value ? 'servingReads' and is_public from public.app_config where key = 'recs'));
select chk('substitute depths are configured and private',
  (select (value ->> 'substitutesOwn')::int > 0 and (value ->> 'substitutesAll')::int > 0 and not is_public
     from public.app_config where key = 'precompute'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
