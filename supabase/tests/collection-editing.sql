-- Exercises set_collection_card_quantity: card-level totals over printing-level entries, own collection only.
-- Runs in a transaction and rolls back. Needs the local catalog.
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
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as sol,
  (select p.id from public.printings p join public.cards c on c.id = p.card_id where c.slug = 'sol-ring' limit 1) as sol_printing
\gset
select chk('fixtures resolve', :sol is not null and :'sol_printing' <> '');

-- User A owns 3 Sol Rings of one printing from an import.
insert into public.collection_items (user_id, card_id, printing_id, finish, condition, lang, quantity)
values ('11111111-1111-1111-1111-111111111111', :sol, :'sol_printing', 'foil', 'NM', 'en', 3);
create temp table ids (card integer);
grant all on ids to authenticated, anon;
insert into ids values (:sol);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select chk('raising the total adds a generic entry', public.set_collection_card_quantity(:sol, 5) = 5);
select chk('the imported printing is untouched',
  (select quantity = 3 from public.collection_items where card_id = :sol and printing_id = :'sol_printing'));
select chk('the generic entry holds the difference',
  (select quantity = 2 and finish = 'nonfoil' and condition = 'NM' and lang = 'en' from public.collection_items where card_id = :sol and printing_id is null));

select chk('lowering takes from the generic entry first', public.set_collection_card_quantity(:sol, 4) = 4);
select chk('generic entry down to 1', (select quantity = 1 from public.collection_items where card_id = :sol and printing_id is null));
select chk('lowering past it empties it, then takes from the printing', public.set_collection_card_quantity(:sol, 2) = 2);
select chk('generic entry gone', not exists (select 1 from public.collection_items where card_id = :sol and printing_id is null));
select chk('printing down to 2', (select quantity = 2 from public.collection_items where card_id = :sol and printing_id = :'sol_printing'));
select chk('the same total writes nothing', public.set_collection_card_quantity(:sol, 2) = 2);
select chk('0 removes the card', public.set_collection_card_quantity(:sol, 0) = 0);
select chk('no Sol Ring left', not exists (select 1 from public.collection_items where card_id = :sol));

do $$ begin
  perform public.set_collection_card_quantity(2147483600, 1);
  insert into t values ('an unknown card is refused', false, 'no error raised');
exception when others then
  insert into t values ('an unknown card is refused', sqlerrm like '%CARD_NOT_FOUND%', sqlerrm);
end $$;

-- User B edits only their own collection.
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select public.set_collection_card_quantity(:sol, 1);
reset role;
select chk('B''s edit went into B''s collection',
  (select count(*) = 1 from public.collection_items where card_id = :sol and user_id = '22222222-2222-2222-2222-222222222222'));
select chk('and not into A''s',
  not exists (select 1 from public.collection_items where card_id = :sol and user_id = '11111111-1111-1111-1111-111111111111'));

set local role anon;
do $$
declare c integer := (select ids.card from ids);
begin
  perform public.set_collection_card_quantity(c, 1);
  insert into t values ('anon cannot edit a collection', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot edit a collection', true, sqlerrm);
end $$;

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
