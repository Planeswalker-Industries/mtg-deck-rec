-- Building a deck (T063): serving_build_pool and app_config.scoring.build. Needs the local catalog and corpus.
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- The single commander with the most decks, and the first card of its pool as a card to keep.
select k.commander_1 as cmd
from public.commander_keys k join public.commander_stats s on s.commander_key_id = k.id
where k.commander_2 is null order by s.deck_count desc, k.id limit 1 \gset
select (p.card).card_id as kept
from public.serving_add_pool(array[:cmd], array[:cmd], true, null, 400, 'adds') p order by p.pool, p."position" limit 1 \gset

select public.serving_build_pool(array[:cmd], array[:kept], array[:cmd, :kept], true, array['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']) as v \gset
create temp table v as select :'v'::jsonb as v;
create temp table ids as
  select distinct (p -> 'card' ->> 'card_id')::int as id from v, jsonb_array_elements(v -> 'pool') p
  union select :kept;

select chk('the pool is the add pool, everyone''s alone without a collection',
  jsonb_array_length(v -> 'pool') > 0 and not exists (select 1 from jsonb_array_elements(v -> 'pool') p where p ->> 'part' <> 'own')) from v;
select chk('the commander and the kept card stay out of the pool',
  not exists (select 1 from v, jsonb_array_elements(v -> 'pool') p where (p -> 'card' ->> 'card_id')::int in (:cmd, :kept)));
select chk('pairs join two of its cards (the kept ones included)',
  not exists (
    select 1 from v, jsonb_array_elements((v -> 'own') || (v -> 'global')) r
    where (r ->> 0)::int not in (select id from ids) or (r ->> 1)::int not in (select id from ids)));
select chk('every card comes with its weight, the kept one included',
  (select count(*) from v, jsonb_array_elements(v -> 'cards')) = (select count(*) from ids)
  and exists (select 1 from v, jsonb_array_elements(v -> 'cards') c where (c ->> 0)::int = :kept));
select chk('combos come without card rows, each missing card once beside them',
  not exists (select 1 from v, jsonb_array_elements(v -> 'combos') c where c ? 'card')
  and (select count(*) from v, jsonb_array_elements(v -> 'missing'))
      = (select count(distinct (c ->> 'missing')::int) from v, jsonb_array_elements(v -> 'combos') c where c ->> 'missing' is not null));
select chk('the basic lands come by name, basic lands only',
  jsonb_array_length(v -> 'basics') between 1 and 6
  and not exists (
    select 1 from jsonb_array_elements(v -> 'basics') b join public.cards c on c.id = (b ->> 'card_id')::int where not c.is_basic_land)) from v;

-- A collection: the owned pool holds owned cards only, and everyone's pool comes beside it for the value fill.
select array_agg(id) as owned from (select id from ids where id <> :kept order by id limit 40) x \gset
select public.serving_build_pool(array[:cmd], '{}', array[:cmd], true, array['Plains'], :'owned'::int[]) as w \gset
select chk('with a collection, its pool holds only owned cards',
  not exists (
    select 1 from jsonb_array_elements(:'w'::jsonb -> 'pool') p
    where p ->> 'part' = 'own' and (p -> 'card' ->> 'card_id')::int <> all (:'owned'::int[])));
select chk('and everyone''s pool comes beside it',
  exists (select 1 from jsonb_array_elements(:'w'::jsonb -> 'pool') p where p ->> 'part' = 'open'));

select chk('the build settings are in app_config.scoring',
  (select jsonb_array_length(value -> 'build' -> 'landCounts') = 6 and jsonb_array_length(value -> 'build' -> 'basicLandCounts') = 6
     and (value -> 'build' ->> 'qualityFloor')::numeric = 0.35
   from public.app_config where key = 'scoring'));

set local role anon;
select chk('anon builds', public.serving_build_pool(array[:cmd], '{}', array[:cmd], true, array['Plains']) is not null);

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;
rollback;
