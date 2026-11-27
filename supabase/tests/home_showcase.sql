-- The homepage's Commanders & Decks read (T109): Popular counts distinct visitors per commander key from `shown` events
-- (pairs in either order, `{}` and unknown ids dropped), ties by corpus deck count then slug, filled from the corpus's
-- most played keys; Latest lists public 100-card decks, the newest per commander, newest first. Neither returns voter
-- keys, user ids, deck names or private decks, and anon may run it. Runs in a transaction and rolls back, so it leaves
-- nothing behind. Needs the local catalog and corpus.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;
grant execute on function chk(text, boolean, text) to anon, authenticated, service_role;
create or replace function must_fail(p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into t values (p_name, false, 'no error raised');
exception when others then
  insert into t values (p_name, sqlerrm ilike '%' || p_expect || '%', sqlerrm);
end $$;
grant execute on function must_fail(text, text, text) to anon, authenticated, service_role;

-- What anon got back, one row per call.
create temp table res (label text primary key, v jsonb);
grant all on res to anon, authenticated;
create or replace function call_as_anon(p_label text, p_days integer default 30) returns void
language plpgsql as $$
begin
  set local role anon;
  insert into res values (p_label, public.home_showcase(p_days));
  reset role;
end $$;
grant execute on function call_as_anon(text, integer) to anon, authenticated, service_role;
-- The slugs of a call's column, in order.
create or replace function slugs(p_label text, p_col text) returns text[]
language sql as $$
  select coalesce(array_agg(x ->> 'slug' order by o), '{}') from res, jsonb_array_elements(v -> p_col) with ordinality as e(x, o)
  where label = p_label;
$$;

-- Fixture keys: five single commanders and one pair, each with corpus stats and live cards. Their deck counts are set
-- above every other key's, so the corpus fill is theirs: a 50, b 40, c 30, d 20, p 10 over the corpus maximum.
create temp view live_keys as
  select k.* from public.commander_keys k
  join public.commander_stats s on s.commander_key_id = k.id
  where exists (select 1 from public.cards c where c.id = k.commander_1 and c.deleted_at is null)
    and (k.commander_2 is null or exists (select 1 from public.cards c where c.id = k.commander_2 and c.deleted_at is null));
select coalesce(max(deck_count), 0) as top from public.commander_stats \gset
select
  (select id from live_keys where commander_2 is null order by id offset 0 limit 1) as ka,
  (select id from live_keys where commander_2 is null order by id offset 1 limit 1) as kb,
  (select id from live_keys where commander_2 is null order by id offset 2 limit 1) as kc,
  (select id from live_keys where commander_2 is null order by id offset 3 limit 1) as kd,
  (select id from live_keys where commander_2 is null order by id offset 4 limit 1) as ke,
  (select id from live_keys where commander_2 is not null order by id limit 1) as kp,
  (select min(c.id) from public.cards c
    where c.deleted_at is null and c.can_be_commander
      and not exists (select 1 from public.commander_keys k where k.commander_1 = c.id or k.commander_2 = c.id)) as keyless,
  (select id from auth.users order by created_at limit 1) as owner
\gset
select chk('fixtures resolve', :'ka' <> '' and :'kb' <> '' and :'kc' <> '' and :'kd' <> '' and :'ke' <> '' and :'kp' <> ''
  and :'keyless' <> '' and :'owner' <> '');
select
  (select slug from public.commander_keys where id = :ka) as sa,
  (select slug from public.commander_keys where id = :kb) as sb,
  (select slug from public.commander_keys where id = :kc) as sc,
  (select slug from public.commander_keys where id = :kd) as sd,
  (select slug from public.commander_keys where id = :kp) as sp,
  (select commander_1 from public.commander_keys where id = :ka) as ca,
  (select commander_1 from public.commander_keys where id = :kb) as cb,
  (select commander_1 from public.commander_keys where id = :kc) as cc,
  (select commander_1 from public.commander_keys where id = :kd) as cd,
  (select commander_1 from public.commander_keys where id = :ke) as ce,
  (select commander_1 from public.commander_keys where id = :kp) as plo,
  (select commander_2 from public.commander_keys where id = :kp) as phi
\gset
update public.commander_stats set deck_count = :top + 50 where commander_key_id = :ka;
update public.commander_stats set deck_count = :top + 40 where commander_key_id = :kb;
update public.commander_stats set deck_count = :top + 30 where commander_key_id = :kc;
update public.commander_stats set deck_count = :top + 20 where commander_key_id = :kd;
update public.commander_stats set deck_count = :top + 10 where commander_key_id = :kp;

-- A clean slate for both columns.
delete from public.rec_events;
delete from public.decks;

create or replace function ev(p_voter text, p_ids integer[], p_age interval default '1 hour', p_kind text default 'shown')
returns void language sql as $$
  insert into public.rec_events (voter_key, batch_id, kind, mode, card_ids, position, commander_ids, collection, created_at)
  values (p_voter, gen_random_uuid(), p_kind, 'add', '{1}', case when p_kind = 'shown' then null else 0 end, p_ids, 'none',
          now() - p_age);
$$;

-- === Popular ===
-- No app events: the corpus's top three.
select call_as_anon('empty');
select chk('no events: corpus top three', slugs('empty', 'popular') = array[:'sa', :'sb', :'sc'], (select v::text from res where label = 'empty'));
select chk('corpus fill counts zero visitors',
  (select bool_and((x ->> 'visitors')::int = 0) from res, jsonb_array_elements(v -> 'popular') x where label = 'empty'));
select chk('deckCount is the corpus count',
  (select (v -> 'popular' -> 0 ->> 'deckCount')::int from res where label = 'empty') = :top + 50);

-- One app key, from one visitor's many lists: it leads with one visitor, the corpus fills the rest.
select ev('v:one', array[:cd]), ev('v:one', array[:cd]), ev('v:one', array[:cd], '2 days');
select call_as_anon('one');
select chk('one app key leads, corpus fills', slugs('one', 'popular') = array[:'sd', :'sa', :'sb'], (select v::text from res where label = 'one'));
select chk('a visitor counts once', (select (v -> 'popular' -> 0 ->> 'visitors')::int from res where label = 'one') = 1);

-- A pair given in reverse order matches its key; `{}`, unknown ids, decisions and old rows count for nothing.
select ev('v:p1', array[:phi, :plo]), ev('v:p2', array[:plo, :phi]);
select ev('v:e' || g, '{}') from generate_series(1, 5) g;
select ev('v:u' || g, array[-1]) from generate_series(1, 5) g;
select ev('v:x' || g, array[:ce], '1 hour', 'accepted') from generate_series(1, 5) g;
select ev('v:o' || g, array[:ce], '40 days') from generate_series(1, 5) g;
select call_as_anon('pair');
select chk('reversed pair matches its key', slugs('pair', 'popular') = array[:'sp', :'sd', :'sa'], (select v::text from res where label = 'pair'));
select chk('pair entry names both commanders',
  (select (v -> 'popular' -> 0 ->> 'commander1')::int = :plo and (v -> 'popular' -> 0 ->> 'commander2')::int = :phi
     and (v -> 'popular' -> 0 ->> 'visitors')::int = 2 from res where label = 'pair'));
select chk('single entry has no second commander',
  (select v -> 'popular' -> 1 -> 'commander2' = 'null'::jsonb from res where label = 'pair'));

-- p_days: the 40-day rows count over 60 days; 1000 clamps to 90 (a 100-day row stays out); 0 clamps to 1 day.
select ev('v:old' || g, array[:ce], '100 days') from generate_series(1, 9) g;
select call_as_anon('sixty', 60);
select call_as_anon('clamp_high', 1000);
select call_as_anon('clamp_low', 0);
select chk('60 days: the 40-day visitors lead',
  (select v -> 'popular' -> 0 ->> 'visitors' from res where label = 'sixty') = '5');
select chk('p_days clamps to 90 days',
  (select v -> 'popular' -> 0 ->> 'visitors' from res where label = 'clamp_high') = '5');
select chk('p_days clamps to 1 day', slugs('clamp_low', 'popular') = array[:'sp', :'sd', :'sa'], (select v::text from res where label = 'clamp_low'));

-- Ties by deck count: b and c each gain one visitor, tying d; four app keys, three shown.
select ev('v:b', array[:cb]), ev('v:c', array[:cc]);
select call_as_anon('ties');
select chk('ties by deck count, at most three', slugs('ties', 'popular') = array[:'sp', :'sb', :'sc'], (select v::text from res where label = 'ties'));
-- Equal visitors and equal deck counts: by slug.
update public.commander_stats set deck_count = :top + 5 where commander_key_id in (:kb, :kc, :kd);
select call_as_anon('slug_ties');
select chk('then by slug',
  slugs('slug_ties', 'popular') = array[:'sp'] || (select array_agg(s order by s) from unnest(array[:'sb', :'sc', :'sd']) s)
  [1:2], (select v::text from res where label = 'slug_ties'));

select chk('popular items carry only the designed fields',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['commander1', 'commander2', 'deckCount', 'slug', 'visitors'])
   from res, jsonb_array_elements(v -> 'popular') x));

-- === Latest ===
create or replace function deck(p_code text, p_c1 integer, p_c2 integer, p_age interval, p_public boolean default true,
                                p_cards integer default 100)
returns void language sql as $$
  insert into public.decks (user_id, name, is_public, commander_1, commander_2, card_count, code, created_at)
  select id, 'Secret name ' || p_code, p_public, p_c1, p_c2, p_cards, p_code, now() - p_age
  from auth.users order by created_at limit 1;
$$;
select call_as_anon('no_decks');
select chk('no decks: latest is empty', (select v -> 'latest' from res where label = 'no_decks') = '[]'::jsonb);

select deck('deckKeyless1', :keyless, null, '30 minutes');
select deck('deckAnewer01', :ca, null, '1 hour');
select deck('deckAolder01', :ca, null, '2 hours');
select deck('deckHidden01', :cb, null, '10 minutes', false);
select deck('deckShort001', :cc, null, '10 minutes', true, 99);
select deck('deckNoCmdr01', null, null, '5 minutes');
select deck('deckPairRev1', :phi, :plo, '3 hours');
select deck('deckD0000001', :cd, null, '4 hours');
select call_as_anon('latest');
select chk('newest per commander, newest first, at most three',
  (select array_agg(x ->> 'code' order by o) from res, jsonb_array_elements(v -> 'latest') with ordinality e(x, o)
   where label = 'latest') = array['deckKeyless1', 'deckAnewer01', 'deckPairRev1'],
  (select v -> 'latest' from res where label = 'latest')::text);
select chk('a commander with no corpus key has no slug',
  (select v -> 'latest' -> 0 -> 'slug' = 'null'::jsonb from res where label = 'latest'));
select chk('a reversed pair deck carries its key slug, lower id first',
  (select v -> 'latest' -> 2 ->> 'slug' = :'sp' and (v -> 'latest' -> 2 ->> 'commander1')::int = :plo
     and (v -> 'latest' -> 2 ->> 'commander2')::int = :phi from res where label = 'latest'));
select chk('latest items carry only the designed fields',
  (select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['code', 'commander1', 'commander2', 'createdAt', 'slug'])
   from res, jsonb_array_elements(v -> 'latest') x where label = 'latest'));
select chk('no deck names reach the result', (select v::text not ilike '%Secret name%' from res where label = 'latest'));
select chk('no voter keys reach the result', (select bool_and(v::text not like '%v:%') from res));

-- === Grants ===
select chk('anon and authenticated may run it',
  has_function_privilege('anon', 'public.home_showcase(integer)', 'execute')
  and has_function_privilege('authenticated', 'public.home_showcase(integer)', 'execute'));
set local role anon;
select must_fail('anon still cannot read rec_events', 'select count(*) from public.rec_events', 'permission denied');
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;
do $$ begin if exists (select 1 from t where not ok) then raise exception 'home_showcase: checks failed'; end if; end $$;

rollback;
