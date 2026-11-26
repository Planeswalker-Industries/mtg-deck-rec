-- The day's crawl budget (20261127000400_crawl_daily_budget.sql): crawl_used_today sums the part of one source's runs
-- inside today (UTC), start to finish, an open run to now, an abandoned run to its last sign of life, and leaves out
-- runs that never held the claim, runs that ended before midnight and other sources. The worker row carries the resume knobs, and only the
-- service role may call the function. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

delete from crawl.runs where source = 'moxfield';
select date_trunc('day', now() at time zone 'utc') at time zone 'utc' as day_start \gset

select chk('no runs today is no time used', public.crawl_used_today('moxfield') = 0);

-- A failed run of an hour, and one from yesterday that must not count.
insert into crawl.runs (source, state, started_at, finished_at, error) values
  ('moxfield', 'failed', :'day_start'::timestamptz, :'day_start'::timestamptz + interval '1 hour', 'cancelled'),
  ('moxfield', 'succeeded', :'day_start'::timestamptz - interval '3 hours', :'day_start'::timestamptz - interval '30 minutes', null);
select chk('a finished run counts start to finish; yesterday''s does not',
  public.crawl_used_today('moxfield') = 3600, public.crawl_used_today('moxfield')::text);

-- A run that never held the claim crawled nothing, however long its row says it lasted.
insert into crawl.runs (source, state, started_at, finished_at, error) values
  ('moxfield', 'failed', :'day_start'::timestamptz + interval '1 hour', :'day_start'::timestamptz + interval '2 hours', 'already running');
select chk('an unclaimed run does not count', public.crawl_used_today('moxfield') = 3600,
  public.crawl_used_today('moxfield')::text);

-- Abandoned runs: one that reported progress half an hour in, one that never reported any.
insert into crawl.runs (source, state, started_at, progress_at, finished_at, error) values
  ('moxfield', 'failed', :'day_start'::timestamptz + interval '2 hours', :'day_start'::timestamptz + interval '150 minutes',
   :'day_start'::timestamptz + interval '10 hours', 'abandoned: no progress for 480 min'),
  ('moxfield', 'failed', :'day_start'::timestamptz + interval '3 hours', null,
   :'day_start'::timestamptz + interval '11 hours', 'abandoned: the claim went stale and was taken over');
select chk('an abandoned run counts to its last progress, not to when it was closed',
  public.crawl_used_today('moxfield') = 3600 + 1800, public.crawl_used_today('moxfield')::text);

-- Another source's run is its own budget.
insert into crawl.runs (source, state, started_at, finished_at, error) values
  ('archidekt', 'failed', :'day_start'::timestamptz, :'day_start'::timestamptz + interval '5 hours', 'cancelled');
select chk('another source does not count', public.crawl_used_today('moxfield') = 3600 + 1800);


-- A run that began yesterday counts only its part after midnight.
insert into crawl.runs (source, state, started_at, finished_at, error) values
  ('moxfield', 'succeeded', :'day_start'::timestamptz - interval '2 hours', :'day_start'::timestamptz + interval '15 minutes', null);
select chk('a run across midnight counts only today''s part', public.crawl_used_today('moxfield') = 3600 + 1800 + 900,
  public.crawl_used_today('moxfield')::text);

-- A row from last week that nothing closed is not crawling today.
insert into crawl.runs (source, state, started_at) values ('moxfield', 'queued', :'day_start'::timestamptz - interval '7 days');
select chk('an old row left open does not count', public.crawl_used_today('moxfield') = 3600 + 1800 + 900,
  public.crawl_used_today('moxfield')::text);

-- An open run counts to now (the transaction's clock).
insert into crawl.runs (source, state, started_at) values ('moxfield', 'running', :'day_start'::timestamptz);
select chk('an open run counts to now',
  public.crawl_used_today('moxfield') = 3600 + 1800 + 900 + extract(epoch from now() - :'day_start'::timestamptz)::integer,
  public.crawl_used_today('moxfield')::text);

-- === the worker's knobs ===
select chk('the worker row carries the resume knobs',
  (select (value ->> 'crawlResumeMinutes')::int = 10 and (value ->> 'crawlResumesPerDay')::int = 3
     from public.app_config where key = 'worker'));

-- === API roles ===
select chk('anon and authenticated cannot read the budget',
  not has_function_privilege('anon', 'public.crawl_used_today(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.crawl_used_today(text)', 'execute'));
select chk('service_role can read the budget',
  has_function_privilege('service_role', 'public.crawl_used_today(text)', 'execute'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
