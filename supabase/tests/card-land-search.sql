-- The mana columns reach serving_cards (T046). Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

create temp table probe as
select id from public.cards where deleted_at is null and type_line like '%Land%' order by id limit 1;
update public.cards set fetchable_mana = '{U,B}', fetchable_basic_only = true where id = (select id from probe);

select chk('serving_cards returns fetchable_mana and fetchable_basic_only',
           (select r.fetchable_mana = '{U,B}' and r.fetchable_basic_only
              from public.serving_cards('{}'::integer[], array[(select id from probe)]) r));
select chk('serving_cards returns produced_mana for Sol Ring',
           (select r.produced_mana = '{C}'
              from public.serving_cards('{}'::integer[],
                     array[(select id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1)]) r),
           'needs a synced catalog with produced_mana');
select chk('a card that finds nothing reads null and false',
           (select r.fetchable_mana is null and not r.fetchable_basic_only
              from public.serving_cards('{}'::integer[],
                     array[(select id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1)]) r));
select chk('anon may still execute serving_cards',
           has_function_privilege('anon', 'public.serving_cards(integer[], integer[])', 'execute'));

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
