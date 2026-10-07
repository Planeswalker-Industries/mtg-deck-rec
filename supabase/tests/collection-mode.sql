-- Collection mode (T059): decks marked built, and my_card_availability, which says what a player's collection can put
-- into a deck. One user never sees another's copies or decks. Needs the local catalog.
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid', '', now(), now());

select
  (select id from public.cards where slug = 'liesa-forgotten-archangel' and deleted_at is null) as cmd,
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'arcane-signet' and deleted_at is null) as c2
\gset
select (select id from public.printings where card_id = :c1 limit 1) as ring_printing \gset
select chk('fixtures resolve', :cmd is not null and :c1 is not null and :c2 is not null and :'ring_printing' <> '');

-- User A owns three Sol Rings over two entries and one Arcane Signet; user B owns a Sol Ring of their own.
insert into public.collection_items (user_id, card_id, printing_id, finish, condition, lang, quantity) values
  ('11111111-1111-1111-1111-111111111111', :c1, null, 'nonfoil', 'NM', 'en', 1),
  ('11111111-1111-1111-1111-111111111111', :c1, :'ring_printing', 'foil', 'NM', 'en', 2),
  ('11111111-1111-1111-1111-111111111111', :c2, null, 'nonfoil', 'NM', 'en', 1),
  ('22222222-2222-2222-2222-222222222222', :c1, null, 'nonfoil', 'NM', 'en', 5);

-- === user A: two decks, one of them built ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select public.save_deck(null, 'Built Liesa',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main')
  ), null) as built_deck
\gset
select public.save_deck(null, 'Brewing Liesa',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c2, 'quantity', 1, 'section', 'main')
  ), null) as brew_deck
\gset

select chk('a new deck is not built', (select not is_built from public.decks where id = :'built_deck'));
select updated_at as before_built from public.decks where id = :'built_deck' \gset
select public.set_deck_built(:'built_deck', true);
select chk('the owner marks a deck built', (select is_built from public.decks where id = :'built_deck'));
select chk('marking a deck built leaves updated_at alone (the corpus reads nothing new)',
  (select updated_at = :'before_built'::timestamptz from public.decks where id = :'built_deck'));

select public.my_card_availability() as avail \gset
select chk('owned copies sum over every entry of a card',
  (select (e ->> 1)::int = 3 from jsonb_array_elements(:'avail'::jsonb -> 'owned') e where (e ->> 0)::int = :c1));
select chk('a built deck is listed with the copies it holds, its commander included',
  (select count(*) = 1 from jsonb_array_elements(:'avail'::jsonb -> 'built') d where d ->> 'id' = :'built_deck')
  and (select jsonb_array_length(d -> 'cards') = 2 and d ->> 'name' = 'Built Liesa' and d ->> 'code' <> ''
         from jsonb_array_elements(:'avail'::jsonb -> 'built') d where d ->> 'id' = :'built_deck'));
select chk('a deck still being brewed holds nothing',
  (select count(*) = 0 from jsonb_array_elements(:'avail'::jsonb -> 'built') d where d ->> 'id' = :'brew_deck'));
select chk('the deck being improved is left out: its copies are its own',
  (select jsonb_array_length(public.my_card_availability(:'built_deck') -> 'built') = 0));

-- === user B ===
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select chk('another user sees only their own copies and no one else''s decks',
  (select public.my_card_availability() = jsonb_build_object('owned', jsonb_build_array(jsonb_build_array(:c1, 5)), 'built', '[]'::jsonb)));
do $$
begin
  perform public.set_deck_built((select id from public.decks where name = 'Brewing Liesa'), true);
  insert into t values ('another user cannot mark a deck built', false, 'no error');
exception when others then
  insert into t values ('another user cannot mark a deck built', sqlerrm = 'DECK_NOT_FOUND', sqlerrm);
end $$;

-- === signed out ===
set local role anon;
do $$
begin
  perform public.my_card_availability();
  insert into t values ('anon cannot read availability', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot read availability', true, '');
end $$;
do $$
begin
  perform public.set_deck_built('00000000-0000-0000-0000-000000000000', true);
  insert into t values ('anon cannot mark a deck built', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot mark a deck built', true, '');
end $$;

-- === the pool and the settings ===
reset role;
select chk('a collection pool holds the colours'' cards as well as the commander''s',
  (select count(distinct pool) = 2 and bool_and(pool in ('commander', 'baseline'))
     from public.serving_add_pool(array[:cmd], '{}'::integer[], true,
                                  (select array_agg(id) from (select id from public.cards where legal_commander = 'legal' order by id limit 5000) x),
                                  50, 'adds')));
select chk('without a collection the commander''s pool stands alone',
  (select bool_and(pool = 'commander') from public.serving_add_pool(array[:cmd], '{}'::integer[], true, null, 50, 'adds')));
select chk('the buy list is configured',
  (select value -> 'collection' ?& array['buyMargin', 'priceFloorUsd', 'buyListSize'] from public.app_config where key = 'scoring'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
