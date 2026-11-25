-- A crawl run's progress and the sweep that closes runs no process owns (20261126000100_crawl_run_progress.sql):
-- progress opens a queued run and writes its counters but never touches a finished one, the sweep closes stale open
-- runs and `running` rows that already finished while leaving the live claim's run alone, only the service role may
-- call either, and the admin overview carries the last run's progress. Runs in a transaction and rolls back, so it
-- leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- A source of its own: close whatever open moxfield runs this database already has, so the sweep's count is the
-- test's own rows.
insert into crawl.state (source) values ('moxfield') on conflict do nothing;
update crawl.state set running_run_id = null, client_id = null, claimed_at = null where source = 'moxfield';
update crawl.runs set state = 'failed', finished_at = coalesce(finished_at, now())
 where source = 'moxfield' and (state in ('queued', 'running'));

-- === progress ===
insert into crawl.runs (source, state) values ('moxfield', 'queued') returning id as queued_run \gset
select public.crawl_run_progress(:queued_run,
  '{"state": "succeeded", "commanders_visited": 3, "decks_written": 12, "throttles": 1, "throttled_position": "X page 2"}'::jsonb);
select chk('progress opens a queued run as running with its counters',
  (select state = 'running' and commanders_visited = 3 and decks_written = 12 and throttles = 1
          and throttled_position = 'X page 2' and progress_at is not null and finished_at is null
     from crawl.runs where id = :queued_run));

insert into crawl.runs (source, state, finished_at, decks_written)
values ('moxfield', 'succeeded', now(), 5) returning id as done_run \gset
select public.crawl_run_progress(:done_run, '{"decks_written": 99}'::jsonb);
select chk('progress never touches a finished run',
  (select state = 'succeeded' and decks_written = 5 and progress_at is null from crawl.runs where id = :done_run));

-- === the sweep ===
-- Dead: started ten hours ago, never reported progress.
insert into crawl.runs (source, state, started_at)
values ('moxfield', 'running', now() - interval '10 hours') returning id as dead_run \gset
-- Dead while queued: its process never got as far as the claim.
insert into crawl.runs (source, state, started_at)
values ('moxfield', 'queued', now() - interval '10 hours') returning id as dead_queued \gset
-- A panic's leftover: running, with a finished_at.
insert into crawl.runs (source, state, started_at, finished_at)
values ('moxfield', 'running', now() - interval '1 hour', now() - interval '30 minutes') returning id as panicked_run \gset
-- Alive: old, quiet, but the source's fresh claim points at it.
insert into crawl.runs (source, state, started_at)
values ('moxfield', 'running', now() - interval '10 hours') returning id as live_run \gset
update crawl.state set running_run_id = :live_run, client_id = 'test', claimed_at = now() - interval '1 hour'
 where source = 'moxfield';
-- Alive: started long ago, reported progress a minute ago.
insert into crawl.runs (source, state, started_at, progress_at)
values ('moxfield', 'running', now() - interval '10 hours', now() - interval '1 minute') returning id as busy_run \gset
-- Another source's dead run is not this sweep's business.
insert into crawl.runs (source, state, started_at)
values ('archidekt', 'running', now() - interval '10 hours') returning id as other_source_run \gset

select chk('the sweep closes the dead, the never-claimed and the panicked rows',
  public.crawl_close_stale_runs('moxfield', 8 * 3600) = 3);
select chk('a run with no progress inside the window is failed as abandoned',
  (select state = 'failed' and finished_at is not null and error = 'abandoned: no progress for 480 min'
     from crawl.runs where id = :dead_run));
select chk('a queued run nobody claimed is failed as abandoned',
  (select state = 'failed' and error like 'abandoned:%' from crawl.runs where id = :dead_queued));
select chk('a running row that already finished is failed and keeps its finish time',
  (select state = 'failed' and error = 'interrupted' and finished_at < now() - interval '29 minutes'
     from crawl.runs where id = :panicked_run));
select chk('the fresh claim''s run is left alone',
  (select state = 'running' and finished_at is null from crawl.runs where id = :live_run));
select chk('a run that reported progress recently is left alone',
  (select state = 'running' and finished_at is null from crawl.runs where id = :busy_run));
select chk('another source''s run is left alone',
  (select state = 'running' from crawl.runs where id = :other_source_run));
select chk('the queued run that reported progress is left alone',
  (select state = 'running' from crawl.runs where id = :queued_run));

-- Once the claim goes stale, its run is fair game too.
update crawl.state set claimed_at = now() - interval '9 hours' where source = 'moxfield';
select chk('a stale claim no longer protects its run', public.crawl_close_stale_runs('moxfield', 8 * 3600) = 1);
select chk('a second sweep finds nothing', public.crawl_close_stale_runs('moxfield', 8 * 3600) = 0);

-- === grants ===
select chk('only the service role may report progress',
  not has_function_privilege('authenticated', 'public.crawl_run_progress(bigint, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.crawl_run_progress(bigint, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.crawl_run_progress(bigint, jsonb)', 'execute'));
select chk('only the service role may sweep',
  not has_function_privilege('authenticated', 'public.crawl_close_stale_runs(text, int)', 'execute')
  and not has_function_privilege('anon', 'public.crawl_close_stale_runs(text, int)', 'execute')
  and has_function_privilege('service_role', 'public.crawl_close_stale_runs(text, int)', 'execute'));
select chk('the overview stays admin-only at the grant level',
  not has_function_privilege('anon', 'public.admin_crawl_overview()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_crawl_overview()', 'execute'));

-- === the admin overview ===
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'crawl-progress-admin@test.invalid', '', now(), now());
insert into public.platform_admins (user_id, note) values ('eeeeeeee-0000-4000-8000-000000000001', 'crawl progress test');
insert into crawl.runs (source, state, progress_at, commanders_visited, throttles)
values ('moxfield', 'running', now(), 7, 2) returning id as newest_run \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';
select chk('the overview carries the last run''s progress',
  (select last_run_id = :newest_run and last_run_progress_at is not null
          and last_run_commanders_visited = 7 and last_run_throttles = 2
     from public.admin_crawl_overview() where source = 'moxfield'));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
