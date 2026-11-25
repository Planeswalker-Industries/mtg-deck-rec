-- Malformed decks are counted on the run (20261127000300_crawl_skip_malformed.sql): progress and finish both write
-- skipped_malformed, a summary without it writes 0, the archidekt policy row carries maxFailedCommandersInRow, the queue
-- says whether a commander's last visit failed (failedBefore), only the service role may call the run writers, and the admin overview carries the last run's count. Runs in a transaction
-- and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into crawl.state (source) values ('moxfield') on conflict do nothing;

-- === progress and finish ===
insert into crawl.runs (source, state) values ('moxfield', 'queued') returning id as run1 \gset
select public.crawl_run_progress(:run1, '{"skipped_malformed": 3, "decks_fetched": 40}'::jsonb);
select chk('progress writes the malformed count',
  (select state = 'running' and skipped_malformed = 3 and decks_fetched = 40 from crawl.runs where id = :run1));

select public.crawl_finish_run(:run1,
  '{"state": "failed", "skipped_malformed": 21, "decks_fetched": 2, "error": "21 of 23 fetched decks were malformed"}'::jsonb);
select chk('finish writes the malformed count',
  (select state = 'failed' and skipped_malformed = 21 and finished_at is not null from crawl.runs where id = :run1));

insert into crawl.runs (source, state) values ('moxfield', 'queued') returning id as run2 \gset
select public.crawl_finish_run(:run2, '{"state": "succeeded", "decks_written": 4}'::jsonb);
select chk('a summary from an older crawl writes 0',
  (select skipped_malformed = 0 and decks_written = 4 from crawl.runs where id = :run2));

-- === policy ===
select chk('the archidekt row names the failed-commander streak',
  (select (value ->> 'maxFailedCommandersInRow')::int = 5 from public.app_config where key = 'archidekt'));

-- === failedBefore ===
delete from crawl.queue where source = 'moxfield';
-- No deck lookup puts a commander first while the checks run.
delete from public.commander_requests;
select id as c1 from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null \gset
insert into crawl.queue (source, commander_card_id) values ('moxfield', :c1);
create or replace function queued(p_run bigint, p_card int) returns jsonb
language sql as $$
  select e from jsonb_array_elements(public.crawl_next_commanders('moxfield', p_run, 50)) e
   where (e ->> 'cardId')::int = p_card
$$;

insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run3 \gset
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run4 \gset
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run5 \gset
select chk('a commander never visited has not failed before',
  (select (queued(:run3, :c1) ->> 'failedBefore')::boolean = false));
select public.crawl_finish_commander('moxfield', :c1, :run3, '{"outcome": "failed", "error": "HTTP 500"}'::jsonb);
select chk('after a failed visit, the next run is told it failed before',
  (select (queued(:run4, :c1) ->> 'failedBefore')::boolean = true));
select public.crawl_finish_commander('moxfield', :c1, :run4, '{"outcome": "done"}'::jsonb);
update crawl.queue set last_visited_at = now() - interval '60 days' where source = 'moxfield' and commander_card_id = :c1;
select chk('a visit that worked clears it',
  (select (queued(:run5, :c1) ->> 'failedBefore')::boolean = false));

-- === API roles ===
select chk('anon and authenticated cannot write runs',
  not has_function_privilege('anon', 'public.crawl_finish_run(bigint, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.crawl_finish_run(bigint, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.crawl_run_progress(bigint, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.crawl_run_progress(bigint, jsonb)', 'execute'));
select chk('service_role can write runs',
  has_function_privilege('service_role', 'public.crawl_finish_run(bigint, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.crawl_run_progress(bigint, jsonb)', 'execute'));
select chk('the overview stays admin-only at the grant level',
  not has_function_privilege('anon', 'public.admin_crawl_overview()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_crawl_overview()', 'execute'));

-- === the admin overview ===
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('eeeeeeee-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'crawl-malformed-admin@test.invalid', '', now(), now());
insert into public.platform_admins (user_id, note) values ('eeeeeeee-0000-4000-8000-000000000002', 'crawl malformed test');
insert into crawl.runs (source, state, skipped_malformed) values ('moxfield', 'running', 6) returning id as newest_run \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000002"}';
select chk('the overview carries the last run''s malformed count',
  (select last_run_id = :newest_run and last_run_skipped_malformed = 6
     from public.admin_crawl_overview() where source = 'moxfield'));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
