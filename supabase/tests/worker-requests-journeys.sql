-- Run-now asks and journey counts (20261126000500_worker_requests_journey_starts.sql): an admin's ask waits once per
-- duty and writes one audit row, a switched-off crawl source and an unknown duty are refused, a player who is not an
-- admin can do neither, the schedule read lists the waiting ask, and a journey start counts site-wide and for its
-- account without the browser's roles being able to call it. Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'run-admin@test.invalid', '', now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'run-player@test.invalid', '', now(), now());
insert into public.platform_admins (user_id, note) values ('aaaaaaaa-0000-4000-8000-0000000000f1', 'test admin');
-- Start from no waiting asks, so the counts below are this test's own.
update public.worker_requests set picked_at = now() where picked_at is null;
update crawl.state set disabled = true where source = 'moxfield';
update crawl.state set disabled = false where source = 'archidekt';

-- === a signed-in player who is not an admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-0000000000f1"}';

do $$ begin
  perform public.admin_request_worker_run('collate');
  insert into t values ('non-admin cannot ask for a run', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot ask for a run', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_worker_schedule();
  insert into t values ('non-admin cannot read the schedule', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot read the schedule', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.record_journey_start('paste', null);
  insert into t values ('a signed-in browser cannot count a journey itself', false, 'no error raised');
exception when others then
  insert into t values ('a signed-in browser cannot count a journey itself', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

set local role anon;
do $$ begin
  perform public.record_journey_start('paste', null);
  insert into t values ('a signed-out browser cannot count a journey itself', false, 'no error raised');
exception when others then
  insert into t values ('a signed-out browser cannot count a journey itself', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

-- === the admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000f1"}';

select public.admin_request_worker_run('collate') as first \gset
select public.admin_request_worker_run('collate') as second \gset
select public.admin_request_worker_run('crawl:archidekt') as crawl \gset

do $$ begin
  perform public.admin_request_worker_run('crawl:moxfield');
  insert into t values ('a switched-off crawl source is refused', false, 'no error raised');
exception when others then
  insert into t values ('a switched-off crawl source is refused', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_request_worker_run('drop_everything');
  insert into t values ('an unknown duty is refused', false, 'no error raised');
exception when others then
  insert into t values ('an unknown duty is refused', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

select public.admin_worker_schedule() as schedule \gset

reset role;
select chk('asking twice while one waits leaves one waiting ask',
  (select count(*) from public.worker_requests where duty = 'collate' and picked_at is null) = 1
  and (:'first'::jsonb)->>'requestedAt' = (:'second'::jsonb)->>'requestedAt', :'second');
select chk('one audit row per new ask, none for the repeat',
  (select count(*) from public.audit_log
    where actor = 'aaaaaaaa-0000-4000-8000-0000000000f1' and action = 'admin.request_worker_run') = 2);
select chk('a switched-on crawl source can be asked for', (:'crawl'::jsonb)->>'duty' = 'crawl:archidekt', :'crawl');
select chk('the schedule lists both waiting asks',
  jsonb_array_length((:'schedule'::jsonb)->'waiting') = 2, :'schedule');
select chk('the schedule carries the worker config, the jobs and the crawl sources',
  (:'schedule'::jsonb) ?& array['schedule', 'jobs', 'crawls', 'waiting']
  and (:'schedule'::jsonb)->'jobs' ? 'corpus_collate'
  and (:'schedule'::jsonb)->'crawls' ? 'archidekt', :'schedule');

-- === journey starts, as the server records them ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000f1"}';
select public.admin_site_stats() as before \gset

set local role service_role;
select from public.record_journey_start('paste', 'bbbbbbbb-0000-4000-8000-0000000000f1');
select from public.record_journey_start('build', 'bbbbbbbb-0000-4000-8000-0000000000f1');
select from public.record_journey_start('paste', null);

do $$ begin
  perform public.record_journey_start('swipe', null);
  insert into t values ('an unknown journey kind is refused', false, 'no error raised');
exception when others then
  insert into t values ('an unknown journey kind is refused', sqlstate = '22023', sqlstate || ' ' || sqlerrm);
end $$;

set local role authenticated;
select public.admin_site_stats() as after \gset

select chk('three starts count in the total and both windows',
  ((:'after'::jsonb)->'journeys'->>'total')::bigint = ((:'before'::jsonb)->'journeys'->>'total')::bigint + 3
  and ((:'after'::jsonb)->'journeys'->>'last24h')::bigint = ((:'before'::jsonb)->'journeys'->>'last24h')::bigint + 3
  and ((:'after'::jsonb)->'journeys'->>'last7d')::bigint = ((:'before'::jsonb)->'journeys'->>'last7d')::bigint + 3, :'after');
select chk('two pastes, one build, two signed in',
  ((:'after'::jsonb)->'journeys'->>'paste')::bigint = ((:'before'::jsonb)->'journeys'->>'paste')::bigint + 2
  and ((:'after'::jsonb)->'journeys'->>'build')::bigint = ((:'before'::jsonb)->'journeys'->>'build')::bigint + 1
  and ((:'after'::jsonb)->'journeys'->>'signedIn')::bigint = ((:'before'::jsonb)->'journeys'->>'signedIn')::bigint + 2, :'after');
select chk('the account shows its two journeys on the Users list',
  (select journey_count from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-0000000000f1')) = 2);

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
