-- Exercises deck budgets (T091): only the deck's owner can save, read or copy one.
-- Runs in a transaction and rolls back, so it leaves nothing behind. Any failed check raises at the end.
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

select (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as c1 \gset
select chk('fixture resolves', :c1 is not null);

-- === user A, the owner ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select public.save_deck(null, 'Budget Deck', jsonb_build_array(jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main')), null, null,
  '{"cardCapUsd": 5, "spendUsd": 50}'::jsonb) as deck_a
\gset
select chk('owner reads the budget back', public.my_deck_budget(:'deck_a') = '{"cardCapUsd": 5.00, "spendUsd": 50.00}'::jsonb,
  public.my_deck_budget(:'deck_a')::text);

select public.save_deck(:'deck_a', 'Budget Deck', '[]'::jsonb, null, null, null);
select chk('a null budget keeps the stored one', public.my_deck_budget(:'deck_a') is not null);

reset role;
create temp table before_save as select xmin::text as x from public.deck_budgets where deck_id = :'deck_a';
grant all on before_save to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.save_deck(:'deck_a', 'Budget Deck', '[]'::jsonb, null, null, '{"cardCapUsd": 5, "spendUsd": 50}'::jsonb);
reset role;
select chk('an unchanged budget is not rewritten',
  (select x from before_save) = (select xmin::text from public.deck_budgets where deck_id = :'deck_a'));
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select public.save_deck(:'deck_a', 'Budget Deck', '[]'::jsonb, null, null, '{"spendUsd": 20}'::jsonb);
select chk('one field alone saves', public.my_deck_budget(:'deck_a') = '{"spendUsd": 20.00}'::jsonb, public.my_deck_budget(:'deck_a')::text);

select public.duplicate_deck(:'deck_a', null) as deck_copy \gset
select chk('owner duplicate copies the budget', public.my_deck_budget(:'deck_copy') = '{"spendUsd": 20.00}'::jsonb);

do $$ begin
  perform public.save_deck(null, 'Bad', '[]'::jsonb, null, null, '{"cardCapUsd": -1}'::jsonb);
  insert into t values ('a negative budget is refused', false, 'no error raised');
exception when others then
  insert into t values ('a negative budget is refused', sqlerrm like '%INVALID_BUDGET%', sqlerrm);
end $$;
do $$ begin
  perform public.save_deck(null, 'Bad', '[]'::jsonb, null, null, '{"cardCapUsd": "5"}'::jsonb);
  insert into t values ('a text budget is refused', false, 'no error raised');
exception when others then
  insert into t values ('a text budget is refused', sqlerrm like '%INVALID_BUDGET%', sqlerrm);
end $$;
do $$ begin
  perform public.save_deck(null, 'Bad', '[]'::jsonb, null, null, '{"cardCap": 5}'::jsonb);
  insert into t values ('an unknown budget field is refused', false, 'no error raised');
exception when others then
  insert into t values ('an unknown budget field is refused', sqlerrm like '%INVALID_BUDGET%', sqlerrm);
end $$;

do $$ begin
  perform count(*) from public.deck_budgets;
  insert into t values ('authenticated cannot select deck_budgets', false, 'no error raised');
exception when insufficient_privilege then
  insert into t values ('authenticated cannot select deck_budgets', true, sqlerrm);
end $$;

-- === user B, another player ===
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select chk('another user reads no budget, though the deck is public',
  public.my_deck_budget(:'deck_a') is null and (select count(*) = 1 from public.decks where id = :'deck_a'));
create temp table ids as select :'deck_a'::uuid as a;
do $$
declare a uuid := (select ids.a from ids);
begin
  perform public.duplicate_deck(a, null);
  insert into t values ('another user cannot duplicate the deck or its budget', false, 'no error raised');
exception when others then
  insert into t values ('another user cannot duplicate the deck or its budget', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm);
end $$;

-- === anon ===
reset role;
grant select on ids to anon;
set local role anon;
set local request.jwt.claims = '{}';
do $$ begin
  perform count(*) from public.deck_budgets;
  insert into t values ('anon cannot select deck_budgets', false, 'no error raised');
exception when insufficient_privilege then
  insert into t values ('anon cannot select deck_budgets', true, sqlerrm);
end $$;
do $$
declare a uuid := (select ids.a from ids);
begin
  perform public.my_deck_budget(a);
  insert into t values ('anon cannot call my_deck_budget', false, 'no error raised');
exception when insufficient_privilege then
  insert into t values ('anon cannot call my_deck_budget', true, sqlerrm);
end $$;

-- === the owner clears it ===
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.save_deck(:'deck_a', 'Budget Deck', '[]'::jsonb, null, null, '{}'::jsonb);
reset role;
select chk('an empty budget clears the row', (select count(*) = 0 from public.deck_budgets where deck_id = :'deck_a'));
delete from public.decks where id = :'deck_copy';
select chk('deleting a deck removes its budget', (select count(*) = 0 from public.deck_budgets where deck_id = :'deck_copy'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
do $$ begin
  if exists (select 1 from t where not ok) then
    raise exception 'deck-budgets: % check(s) failed', (select count(*) from t where not ok);
  end if;
end $$;

rollback;
