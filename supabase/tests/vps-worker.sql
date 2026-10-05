-- Exercises 20261005000100_vps_worker.sql: a requested commander comes first in the crawl queue (and is added to it when
-- the seed list doesn't know it), request runs are told apart from crawls, the worker's schedule is seeded, and the
-- regression fixtures are private. Runs in a transaction and rolls back. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

create or replace function must_fail(p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into t values (p_name, false, 'no error raised');
exception when others then
  insert into t values (p_name, sqlerrm ilike '%' || p_expect || '%', sqlerrm);
end $$;
grant execute on function must_fail(text, text, text) to anon, authenticated, service_role;

select
  (select id from public.cards where slug = 'atraxa-praetors-voice' and deleted_at is null) as popular,
  (select id from public.cards where slug = 'krenko-mob-boss' and deleted_at is null) as requested
\gset
select chk('fixtures resolve', :popular is not null and :requested is not null);

-- A queue where the popular commander would normally come first: never visited, far more decks in the seed list.
delete from corpus.crawl_commanders where source = 'archidekt';
insert into corpus.crawl_commanders (source, commander_card_id, seed_decks, held_decks) values ('archidekt', :popular, 100000, 0);
select public.crawl_create_run('archidekt') as run_id \gset

select chk('without a request, the queue order is unchanged',
  (public.crawl_next_commanders('archidekt', :run_id, 5)->0->>'cardId')::int = :popular);

insert into public.commander_requests (commander_card_id, decks_target) values (:requested, 100);
select chk('a requested commander comes first, even one the seed list does not know',
  (public.crawl_next_commanders('archidekt', :run_id, 5)->0->>'cardId')::int = :requested);
select chk('and is added to the queue',
  exists (select 1 from corpus.crawl_commanders where source = 'archidekt' and commander_card_id = :requested));

update public.commander_requests set status = 'done' where commander_card_id = :requested;
select chk('a finished request no longer jumps the queue',
  (public.crawl_next_commanders('archidekt', :run_id, 5)->0->>'cardId')::int = :popular);

-- === run kinds ===
select chk('a crawl run is a crawl unless the worker says otherwise',
  (select kind from corpus.crawl_runs where id = :run_id) = 'crawl');
select must_fail('only known run kinds', format('update corpus.crawl_runs set kind = %L where id = %s', 'other', :run_id), 'check');

-- === schedule ===
select chk('the worker schedule is seeded',
  (select value ? 'aggregateEveryHours' and value ? 'edhrecEveryDays' and value ? 'crawlHourUtc' from public.app_config where key = 'worker'));

-- === regression fixtures ===
insert into public.regression_fixtures (name, fixture) values ('test fixture', '{"name": "test fixture", "expect": {}}');
select must_fail('a fixture is an object', 'insert into public.regression_fixtures (name, fixture) values (''bad'', ''[]'')', 'check');

set local role anon;
select must_fail('anon cannot read fixtures', 'select count(*) from public.regression_fixtures', 'permission denied');
reset role;
set local role authenticated;
select must_fail('a signed-in user cannot read fixtures', 'select count(*) from public.regression_fixtures', 'permission denied');
reset role;
set local role service_role;
select chk('service_role reads fixtures', (select count(*) = 1 from public.regression_fixtures where name = 'test fixture'));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
