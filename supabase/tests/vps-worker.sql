-- Exercises what the VPS worker (T066) relies on in the database: a commander with an active deck lookup comes first
-- in the crawl's queue and joins it if the seed list doesn't know it, a finished lookup stops jumping the queue, and
-- the worker's schedule and the lookup timings are configured. Runs in a transaction and rolls back, so it leaves
-- nothing behind. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- A source of its own, so the checks see only what they set up.
insert into crawl.state (source) values ('moxfield') on conflict do nothing;
delete from crawl.queue where source = 'moxfield';
-- Only the lookups this script makes count as active.
update public.commander_requests set status = 'failed', finished_at = now()
 where status in ('queued', 'checking', 'collecting', 'aggregating');

select
  (select id from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'tymna-the-weaver' and deleted_at is null) as c2,
  (select id from public.cards where slug = 'liesa-forgotten-archangel' and deleted_at is null) as c3
\gset
select chk('fixtures resolve', :c1 is not null and :c2 is not null and :c3 is not null);

-- Two commanders the seed list knows; the much more played one would come first.
insert into crawl.queue (source, commander_card_id, edhrec_deck_count) values ('moxfield', :c1, 900), ('moxfield', :c2, 10);
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run_id \gset
select chk('without a lookup, the most played commander comes first',
  (select public.crawl_next_commanders('moxfield', :run_id, 5) -> 0 ->> 'cardId')::int = :c1);

-- === a lookup jumps the queue ===
insert into public.commander_requests (commander_card_id, decks_target) values (:c2, 60) returning id as req2 \gset
select chk('a commander someone asked for comes first',
  (select public.crawl_next_commanders('moxfield', :run_id, 5) -> 0 ->> 'cardId')::int = :c2);

insert into public.commander_requests (commander_card_id, decks_target, status) values (:c3, 60, 'collecting');
select public.crawl_next_commanders('moxfield', :run_id, 2) as first_two \gset
select chk('a requested commander the seed list doesn''t know joins the queue',
  exists (select 1 from crawl.queue where source = 'moxfield' and commander_card_id = :c3));
select chk('and comes first too, with the other requested one',
  (select array_agg((e ->> 'cardId')::int) from jsonb_array_elements(:'first_two'::jsonb) e) @> array[:c2, :c3], :'first_two');

-- === visited ===
select public.crawl_finish_commander('moxfield', :c2, :run_id, '{"outcome": "done", "listed": 30, "counted": 25}'::jsonb);
select chk('a run doesn''t hand a requested commander back once it visited it',
  not exists (select 1 from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run_id, 5)) e
               where (e ->> 'cardId')::int = :c2));

update public.commander_requests set status = 'done', finished_at = now() where id = :req2;
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run2 \gset
select chk('a finished lookup no longer jumps the queue',
  (select (e ->> 'cardId')::int from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run2, 5)) with ordinality as x (e, n)
    where (e ->> 'cardId')::int in (:c1, :c2) order by n limit 1) = :c1);

-- === settings ===
select chk('the worker''s schedule is configured',
  (select (value ? 'pollSeconds') and (value ? 'crawlHourUtc') and (value ? 'collateEveryMinutes')
          and (value ? 'baselineHourUtc') and (value ? 'substitutesRebuildDays') and not (value ? 'aggregateEveryHours')
          and (value ? 'edhrecEveryDays') and (value ? 'retryHours')
          and value -> 'crawlSources' = '["archidekt"]'::jsonb
     from public.app_config where key = 'worker'));
select chk('a lookup waits a bounded time for the crawl',
  (select (value ->> 'visitTimeoutMinutes')::int > 0 and (value ->> 'crawlTriggerMinutes')::int > 0
     from public.app_config where key = 'commander_requests'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
