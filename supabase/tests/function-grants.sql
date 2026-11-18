-- Who may run the security-definer functions migration 20261118000200 locked down: the worker's six to no API role,
-- the saved-deck writes to signed-in players only, and new functions in `public` to no API role until their migration
-- grants them. Hosted granted all of them to anon through its default privileges; this keeps a local or CI database
-- saying what hosted must. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

with worker_only (fn) as (
  values ('public.commander_collector_online()'), ('public.commander_request_config()'),
         ('public.commander_request_json(public.commander_requests, text)'), ('public.commander_request_recent(integer)'),
         ('public.serving_commander_pool(integer, integer, smallint, integer[], boolean, integer[], integer)'),
         ('public.serving_partner_pool(integer, integer, smallint, integer[], boolean, integer[], integer)'),
         ('public.precompute_substitutes(integer, integer)')
)
select chk(fn || ' runs for no API role',
           not has_function_privilege('anon', fn, 'execute') and not has_function_privilege('authenticated', fn, 'execute'))
from worker_only;

with deck_writes (fn) as (
  values ('public.duplicate_deck(uuid, text)'), ('public.rename_deck(uuid, text)'),
         ('public.set_deck_built(uuid, boolean)'), ('public.set_deck_visibility(uuid, boolean)')
)
select chk(fn || ' runs for signed-in players only',
           has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'))
from deck_writes;

select chk('new functions in public go to no API role by default',
           not exists (
             select 1
             from pg_default_acl d
             cross join lateral aclexplode(d.defaclacl) a
             where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f'
               and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
           ));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
