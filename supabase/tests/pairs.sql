-- Card pairs and deck affinity (T064): the pair tables and serving_deck_affinity. Needs the local catalog.
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- A five-colour commander and five legal cards, by id order.
select (select id from public.cards where can_be_commander and color_identity = 31 and legal_commander = 'legal' and deleted_at is null order by id limit 1) as cmd \gset
select ids[1] as a, ids[2] as b, ids[3] as c, ids[4] as d, ids[5] as banned_out
from (select array_agg(id order by id) as ids from (
  select id from public.cards where legal_commander = 'legal' and not is_basic_land and not game_changer and deleted_at is null and id <> :cmd
  order by id limit 5) x) y \gset

delete from public.commander_card_pairs where commander_1 = :cmd and commander_2 = 0;
delete from public.card_pairs where card_a in (:a, :b, :c, :d) or card_b in (:a, :b, :c, :d);
insert into public.commander_card_pairs (commander_1, commander_2, card_a, card_b, pair_decks, lift) values
  (:cmd, 0, :a, :b, 40, 3.0),
  (:cmd, 0, :b, :c, 30, 2.0);
insert into public.card_pairs (card_a, card_b, pair_decks, lift) values
  (:a, :d, 500, 2.5),
  (:c, :d, 400, 1.6);

select public.serving_deck_affinity(array[:cmd], array[:a]) as v \gset
select chk('a deck card brings the key''s pairs and the corpus''s that touch it',
  (:'v'::jsonb -> 'own') = jsonb_build_array(jsonb_build_array(:a, :b, 3.0))
  and (:'v'::jsonb -> 'global') = jsonb_build_array(jsonb_build_array(:a, :d, 2.5)));
select chk('each deck card comes with its weight',
  jsonb_array_length(:'v'::jsonb -> 'cards') = 1 and (:'v'::jsonb -> 'cards' -> 0 ->> 0)::int = :a);
select chk('neighbours are the cards its pairs point to, whole, strongest first',
  (select array_agg((n ->> 'card_id')::int) from jsonb_array_elements(:'v'::jsonb -> 'neighbours') n) = array[:b, :d]
  and (:'v'::jsonb -> 'neighbours' -> 0 ->> 'name') is not null);
select chk('a card the deck leaves out is no neighbour, nor is a deck card',
  (select coalesce(array_agg((n ->> 'card_id')::int), '{}') from jsonb_array_elements(public.serving_deck_affinity(array[:cmd], array[:a, :b], array[:d]) -> 'neighbours') n) = '{}'::int[]
  or (select bool_and((n ->> 'card_id')::int not in (:a, :b, :d)) from jsonb_array_elements(public.serving_deck_affinity(array[:cmd], array[:a, :b], array[:d]) -> 'neighbours') n));
select chk('no neighbours when none are asked for',
  jsonb_array_length(public.serving_deck_affinity(array[:cmd], array[:a], '{}', true, 0) -> 'neighbours') = 0);
select chk('a commander without its own pairs reads the corpus''s alone',
  jsonb_array_length(public.serving_deck_affinity(array[:a], array[:c]) -> 'own') = 0
  and jsonb_array_length(public.serving_deck_affinity(array[:a], array[:c]) -> 'global') = 1);
select chk('pairs are stored one way round', not exists (select 1 from public.card_pairs where card_a >= card_b)
  and not exists (select 1 from public.commander_card_pairs where card_a >= card_b));
select chk('the pair settings start at the owner''s lift floor', (select (value ->> 'liftFloor')::numeric = 1.5 from public.app_config where key = 'pairs'));

set local role anon;
select chk('anon reads a deck''s affinity', public.serving_deck_affinity(array[:cmd], array[:a]) is not null);
do $$
begin
  perform 1 from public.card_pairs limit 1;
  insert into t values ('anon cannot read the pair tables directly', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot read the pair tables directly', true, '');
end $$;

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
