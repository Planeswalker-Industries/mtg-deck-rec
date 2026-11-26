-- Exercises the not_found lifecycle of the crawl queue: a not_found visit starts a streak, the commander comes back
-- once its retry is due, is given up once the streak passes the give-up, says when its visit is the last try, and a
-- visit that finds it clears the streak. Runs in a transaction and rolls back, so it leaves nothing behind. Needs the
-- local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- A source of its own with known knobs, so the checks see only what they set up.
insert into crawl.state (source) values ('moxfield') on conflict do nothing;
delete from crawl.queue where source = 'moxfield';
update public.app_config
   set value = value || '{"notFoundRetryDays": 30, "notFoundGiveUpDays": 300}'::jsonb
 where key = 'moxfield';
-- No deck lookup puts a commander first while the checks run.
delete from public.commander_requests;

select
  (select id from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'tymna-the-weaver' and deleted_at is null) as c2
\gset
select chk('fixtures resolve', :c1 is not null and :c2 is not null);
insert into crawl.queue (source, commander_card_id, edhrec_deck_count) values ('moxfield', :c1, 10), ('moxfield', :c2, 5);

create or replace function queued(p_run bigint, p_card int) returns jsonb
language sql as $$
  select e from jsonb_array_elements(public.crawl_next_commanders('moxfield', p_run, 50)) e
   where (e ->> 'cardId')::int = p_card
$$;

-- === a streak begins ===
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run1 \gset
select chk('a commander never missed carries no streak',
  (select queued(:run1, :c1) ->> 'notFoundSince' is null));
select public.crawl_finish_commander('moxfield', :c1, :run1, '{"outcome": "not_found"}'::jsonb);
select chk('a not_found visit starts the streak',
  (select not_found_since is not null from crawl.queue where source = 'moxfield' and commander_card_id = :c1));

insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run2 \gset
select chk('a commander missed today is not retried yet', (select queued(:run2, :c1) is null));

-- === the retry is due ===
update crawl.queue set last_visited_at = now() - interval '31 days', not_found_since = now() - interval '31 days'
 where source = 'moxfield' and commander_card_id = :c1;
select chk('a month on, it is retried', (select queued(:run2, :c1) is not null));
select chk('the retry carries when the streak began',
  (select (queued(:run2, :c1) ->> 'notFoundSince')::timestamptz < now() - interval '30 days'));
select chk('an early retry is not the last', (select (queued(:run2, :c1) ->> 'notFoundLastTry')::boolean = false));

select public.crawl_finish_commander('moxfield', :c1, :run2, '{"outcome": "not_found"}'::jsonb);
select chk('missed again, the streak keeps its start',
  (select not_found_since < now() - interval '30 days' and last_visited_at > now() - interval '1 minute'
     from crawl.queue where source = 'moxfield' and commander_card_id = :c1));

-- === a visit that did not complete leaves the streak alone ===
update crawl.queue set last_visited_at = now() - interval '31 days' where source = 'moxfield' and commander_card_id = :c1;
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run3 \gset
select public.crawl_finish_commander('moxfield', :c1, :run3, '{"outcome": "failed", "error": "boom"}'::jsonb);
select chk('a failed visit keeps the streak',
  (select not_found_since < now() - interval '30 days' from crawl.queue
    where source = 'moxfield' and commander_card_id = :c1));

-- === the last try and the give-up ===
update crawl.queue
   set outcome = 'not_found', last_visited_at = now() - interval '31 days', not_found_since = now() - interval '280 days'
 where source = 'moxfield' and commander_card_id = :c1;
insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run4 \gset
select chk('280 days in, the retry is the last one (the next would fall past 300)',
  (select (queued(:run4, :c1) ->> 'notFoundLastTry')::boolean = true));
update crawl.queue set not_found_since = now() - interval '301 days' where source = 'moxfield' and commander_card_id = :c1;
select chk('past 300 days it is given up', (select queued(:run4, :c1) is null));
select chk('the rest of the queue is untouched', (select queued(:run4, :c2) is not null));

update public.app_config set value = value || '{"notFoundGiveUpDays": 400}'::jsonb where key = 'moxfield';
select chk('the give-up is read from app_config', (select queued(:run4, :c1) is not null));
update public.app_config set value = value || '{"notFoundRetryDays": 40}'::jsonb where key = 'moxfield';
select chk('so is the retry', (select queued(:run4, :c1) is null));
update public.app_config set value = value || '{"notFoundRetryDays": 30, "notFoundGiveUpDays": 300}'::jsonb
 where key = 'moxfield';

-- === found again ===
update crawl.queue set not_found_since = now() - interval '60 days' where source = 'moxfield' and commander_card_id = :c1;
select public.crawl_finish_commander('moxfield', :c1, :run4,
  '{"outcome": "done", "queryName": "Thrasios, Triton Hero", "listed": 60}'::jsonb);
select chk('a visit that finds it clears the streak',
  (select not_found_since is null and outcome = 'done' from crawl.queue
    where source = 'moxfield' and commander_card_id = :c1));

-- === the backfill gave today's not_found rows a streak ===
select chk('no not_found row is left without a streak',
  not exists (select 1 from crawl.queue where outcome = 'not_found' and not_found_since is null));
select chk('the hosted knobs are in app_config',
  (select (value ->> 'notFoundRetryDays')::int = 30 and (value ->> 'notFoundGiveUpDays')::int = 300
     from public.app_config where key = 'archidekt'));

-- === API roles ===
select chk('anon cannot read the queue',
  not has_function_privilege('anon', 'public.crawl_next_commanders(text, bigint, int)', 'execute'));
select chk('a signed-in user cannot finish a commander',
  not has_function_privilege('authenticated', 'public.crawl_finish_commander(text, int, bigint, jsonb)', 'execute'));
select chk('service_role can do both',
  has_function_privilege('service_role', 'public.crawl_next_commanders(text, bigint, int)', 'execute')
    and has_function_privilege('service_role', 'public.crawl_finish_commander(text, int, bigint, jsonb)', 'execute'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
