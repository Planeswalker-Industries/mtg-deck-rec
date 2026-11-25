-- The admin home's site numbers (20261126000400_admin_home.sql): an account and a deck made now count in both the
-- 24-hour and the 7-day window, an older deck only in its total, and a signed-in player who is not an admin is
-- refused. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'home-admin@test.invalid', '', now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'home-player@test.invalid', '', now(), now());
insert into public.platform_admins (user_id, note) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'test admin');

select id as commander_card from public.cards order by id limit 1 \gset

-- === a signed-in player who is not an admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-0000000000e1"}';

do $$ begin
  perform public.admin_site_stats();
  insert into t values ('non-admin cannot read the site numbers', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot read the site numbers', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

-- === the admin, before and after a new deck ===
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1"}';
select public.admin_site_stats() as before \gset

reset role;
insert into public.decks (id, user_id, name, is_public, commander_1, card_count, created_at, updated_at)
values
  ('dddddddd-0000-4000-8000-0000000000e1', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'New deck', true, :commander_card, 1, now(), now()),
  ('dddddddd-0000-4000-8000-0000000000e2', 'bbbbbbbb-0000-4000-8000-0000000000e1', 'Old deck', false, :commander_card, 1,
   now() - interval '30 days', now() - interval '30 days');
insert into public.collection_imports (user_id, source_app, mode, status, rows_total, created_at)
values ('bbbbbbbb-0000-4000-8000-0000000000e1', 'manabox', 'merge', 'open', 1, now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1"}';
select public.admin_site_stats() as after \gset

select chk('the two new accounts count in the total and in both windows',
  ((:'before'::jsonb)->'users'->>'total')::bigint >= 2
  and ((:'before'::jsonb)->'users'->>'last24h')::bigint >= 2
  and ((:'before'::jsonb)->'users'->>'last7d')::bigint >= ((:'before'::jsonb)->'users'->>'last24h')::bigint, :'before');
select chk('both new decks count in the total, one in the public count',
  ((:'after'::jsonb)->'decks'->>'total')::bigint = ((:'before'::jsonb)->'decks'->>'total')::bigint + 2
  and ((:'after'::jsonb)->'decks'->>'public')::bigint = ((:'before'::jsonb)->'decks'->>'public')::bigint + 1, :'after');
select chk('a deck made now counts in both windows, a 30-day-old one in neither',
  ((:'after'::jsonb)->'decks'->>'last24h')::bigint = ((:'before'::jsonb)->'decks'->>'last24h')::bigint + 1
  and ((:'after'::jsonb)->'decks'->>'last7d')::bigint = ((:'before'::jsonb)->'decks'->>'last7d')::bigint + 1, :'after');
select chk('an import started now counts this week',
  ((:'after'::jsonb)->>'importsLast7d')::bigint = ((:'before'::jsonb)->>'importsLast7d')::bigint + 1, :'after');
select chk('every field is present',
  (:'after'::jsonb) ?& array['users', 'decks', 'collections', 'importsLast7d', 'openReports', 'openErrors'], :'after');

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
