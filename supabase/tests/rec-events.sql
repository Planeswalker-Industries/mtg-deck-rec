-- Live accept rate (T065): record_rec_event, its keying and checks, re-keying on account deletion, admin_rec_accept_rates.
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;
grant execute on function chk(text, boolean, text) to authenticated, anon;

-- One player and one admin, made here and gone with the rollback.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000065a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'events-player@test.local', '', now(), now()),
  ('00000000-0000-4000-8000-0000000065a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'events-admin@test.local', '', now(), now());
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000065a2');

set local role anon;
select public.record_rec_event('visitor-1', '00000000-0000-4000-8000-00000000b001', 'shown', 'add', array[11, 12, 13], null, null, array[1], 3::smallint, 'none');
select public.record_rec_event('visitor-1', '00000000-0000-4000-8000-00000000b001', 'shown', 'add', array[11, 12, 13], null, null, array[1], 3::smallint, 'none');
select public.record_rec_event('visitor-1', '00000000-0000-4000-8000-00000000b001', 'declined', 'add', array[12], 1::smallint, null, array[1], 3::smallint, 'none');
select public.record_rec_event('visitor-1', '00000000-0000-4000-8000-00000000b001', 'accepted', 'add', array[12], 1::smallint, null, array[1], 3::smallint, 'none', '{"corpus": 0.8}');
select public.record_rec_event('visitor-1', '00000000-0000-4000-8000-00000000b001', 'accepted', 'add', array[11], 0::smallint, null, array[1], 3::smallint, 'none');
do $$
begin
  perform public.record_rec_event('visitor-1', gen_random_uuid(), 'accepted', 'add', array[11, 12], 0::smallint);
  insert into t values ('a decision names one card', false, 'no error');
exception when others then
  insert into t values ('a decision names one card', sqlerrm like '%INVALID_EVENT%', sqlerrm);
end $$;
do $$
begin
  perform public.record_rec_event('', gen_random_uuid(), 'shown', 'add', array[11]);
  insert into t values ('a signed-out event needs a visitor', false, 'no error');
exception when others then
  insert into t values ('a signed-out event needs a visitor', sqlerrm like '%VOTER_REQUIRED%', sqlerrm);
end $$;
do $$
begin
  perform 1 from public.rec_events limit 1;
  insert into t values ('anon cannot read the events', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot read the events', true, '');
end $$;
do $$
begin
  perform * from public.admin_rec_accept_rates();
  insert into t values ('anon cannot read accept rates', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot read accept rates', true, '');
end $$;
reset role;

select chk('a list shown twice is one row; signed out, keyed by visitor',
  (select count(*) = 1 and bool_and(voter_key = 'v:visitor-1' and user_id is null)
   from public.rec_events where batch_id = '00000000-0000-4000-8000-00000000b001' and kind = 'shown'));
select chk('a card passed on and then taken keeps the last decision, with its components',
  (select count(*) = 1 and bool_and(kind = 'accepted' and components = '{"corpus": 0.8}')
   from public.rec_events where batch_id = '00000000-0000-4000-8000-00000000b001' and card_ids = array[12]));

-- Signed in: keyed by the account, whatever visitor key is sent.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000065a1", "role": "authenticated"}', true);
select public.record_rec_event('visitor-2', '00000000-0000-4000-8000-00000000b002', 'shown', 'swap', array[21, 22], null, 20, array[1], 2::smallint, 'only');
select public.record_rec_event('visitor-2', '00000000-0000-4000-8000-00000000b002', 'declined', 'swap', array[21], 0::smallint, 20, array[1], 2::smallint, 'only');
do $$
begin
  perform * from public.admin_rec_accept_rates();
  insert into t values ('a player who is not an admin cannot read accept rates', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('a player who is not an admin cannot read accept rates', true, '');
end $$;
reset role;
select chk('signed in, keyed by the account',
  (select bool_and(voter_key = 'u:00000000-0000-4000-8000-0000000065a1' and user_id = '00000000-0000-4000-8000-0000000065a1')
   from public.rec_events where batch_id = '00000000-0000-4000-8000-00000000b002'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000065a2", "role": "authenticated"}', true);
create temp table rates as select * from public.admin_rec_accept_rates(30, null, 20);
reset role;
select chk('accept rates count each place in a list shown, taken and passed on',
  (select shown = 1 and accepted = 1 and declined = 0 from rates where mode = 'add' and "position" = 0)
  and (select shown = 1 and accepted = 1 and declined = 0 from rates where mode = 'add' and "position" = 1)
  and (select shown = 1 and accepted = 0 and declined = 0 from rates where mode = 'add' and "position" = 2)
  and (select shown = 1 and accepted = 0 and declined = 1 from rates where mode = 'swap' and "position" = 0));

delete from auth.users where id = '00000000-0000-4000-8000-0000000065a1';
select chk('a deleted account''s events stay, with nothing naming it',
  (select count(*) = 2 and bool_and(voter_key like 'x:%' and user_id is null)
   from public.rec_events where batch_id = '00000000-0000-4000-8000-00000000b002'));
select chk('the events budget is in app_config.rate_limits',
  (select value ? 'events' from public.app_config where key = 'rate_limits'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;
rollback;
