-- Exercises deck originals (deck_snapshots, save_deck_original): written once, owner-only, readable exactly when the
-- deck is. Runs in a transaction and rolls back, so it leaves nothing behind. Needs the local catalog.
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
select chk('fixtures resolve', :cmd is not null and :c1 is not null and :c2 is not null);

-- === user A saves a deck and its original ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select public.save_deck(null, 'Upgraded',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c2, 'quantity', 1, 'section', 'main')
  ), null) as deck_a
\gset
create temp table ids (a uuid);
grant all on ids to authenticated, anon;
insert into ids values (:'deck_a');

select chk('first original is written',
  public.save_deck_original(:'deck_a', jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main'),
    jsonb_build_object('cardId', 2147483600, 'quantity', 1, 'section', 'main'),
    jsonb_build_object('cardId', :c2, 'quantity', 1, 'section', 'sideboard')
  )));
select chk('unknown cards and other sections are dropped',
  (select jsonb_array_length(cards) = 2 from public.deck_snapshots where deck_id = :'deck_a' and kind = 'original'),
  (select cards::text from public.deck_snapshots where deck_id = :'deck_a'));
select chk('a second original is ignored', not public.save_deck_original(:'deck_a', '[]'::jsonb));
select chk('the first original is kept',
  (select jsonb_array_length(cards) = 2 from public.deck_snapshots where deck_id = :'deck_a' and kind = 'original'));
select chk('owner reads the original', (select count(*) = 1 from public.deck_snapshots where deck_id = :'deck_a'));

-- === user B ===
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
declare a uuid := (select ids.a from ids);
begin
  perform public.save_deck_original(a, '[]'::jsonb);
  insert into t values ('another user cannot write an original', false, 'no error raised');
exception when others then
  insert into t values ('another user cannot write an original', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm);
end $$;
select chk('another user reads a public deck''s original', (select count(*) = 1 from public.deck_snapshots where deck_id = :'deck_a'));

-- A hides the deck; its original hides with it.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.set_deck_visibility(:'deck_a', false);
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select chk('another user cannot read a private deck''s original', (select count(*) = 0 from public.deck_snapshots where deck_id = :'deck_a'));

set local role anon;
select chk('anon cannot read a private deck''s original', (select count(*) = 0 from public.deck_snapshots where deck_id = :'deck_a'));
do $$
declare a uuid := (select ids.a from ids);
begin
  perform public.save_deck_original(a, '[]'::jsonb);
  insert into t values ('anon cannot write an original', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot write an original', true, sqlerrm);
end $$;

-- Deleting the deck takes its original.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
delete from public.decks where id = :'deck_a';
reset role;
select chk('deleting the deck deletes its original', (select count(*) = 0 from public.deck_snapshots where deck_id = :'deck_a'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
