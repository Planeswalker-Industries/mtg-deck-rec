-- Exercises `edhrec_card_priors`: the one read the app makes of EDHREC's published numbers.
--
-- The point of the function is that `corpus.edhrec_commanders` and `corpus.edhrec_commander_cards` are out of the
-- API roles' reach (a private schema since 20261005000200) and stay that way, so the checks at the end are the ones
-- that matter: anon may call the function and may not touch the tables behind it. Runs in a transaction and rolls
-- back. Needs the local catalog.
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
grant execute on function must_fail(text, text, text) to anon, authenticated;

select
  (select id from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'tymna-the-weaver' and deleted_at is null) as c2,
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as sol,
  (select id from public.cards where slug = 'arcane-signet' and deleted_at is null) as signet
\gset
select chk('fixtures resolve', :c1 is not null and :c2 is not null and :sol is not null and :signet is not null);

-- A solo page and a pair page, so the keying can be told apart. A loaded database already has real pages for these
-- commanders; they go first, and come back when the transaction rolls back.
delete from corpus.edhrec_commanders
 where (commander_1, coalesce(commander_2, 0)) in ((:c1, 0), (least(:c1, :c2), greatest(:c1, :c2)));
insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at)
values ('zz-solo', :c1, null, 900, now()) returning id as solo \gset
insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at)
values ('zz-pair', least(:c1, :c2), greatest(:c1, :c2), 400, now()) returning id as pair \gset

insert into corpus.edhrec_commander_cards (edhrec_commander_id, card_id, decks_with, potential_decks, synergy)
values (:solo, :sol, 810, 900, 0.1), (:solo, :signet, 450, 900, 0.05),
       (:pair, :sol, 200, 400, 0.02);

-- === the rate ===
select chk('inclusion is decks_with over potential_decks',
  abs(((public.edhrec_card_priors(array[:c1], array[:sol, :signet]) ->> :'sol')::real) - 0.9) < 0.0001,
  public.edhrec_card_priors(array[:c1], array[:sol, :signet])::text);
select chk('every card asked for comes back',
  (select count(*) = 2 from jsonb_object_keys(public.edhrec_card_priors(array[:c1], array[:sol, :signet])) k));
select chk('a card not asked for does not',
  (public.edhrec_card_priors(array[:c1], array[:signet]) ->> :'sol') is null);

-- === keying ===
select chk('one commander reads the solo page, not the pair',
  abs(((public.edhrec_card_priors(array[:c1], array[:sol]) ->> :'sol')::real) - 0.9) < 0.0001);
select chk('a pair reads the pair page',
  abs(((public.edhrec_card_priors(array[:c1, :c2], array[:sol]) ->> :'sol')::real) - 0.5) < 0.0001);
select chk('a pair keys the same whichever order it is passed in',
  public.edhrec_card_priors(array[:c1, :c2], array[:sol]) = public.edhrec_card_priors(array[:c2, :c1], array[:sol]));
select chk('the same commander twice is still one commander',
  public.edhrec_card_priors(array[:c1, :c1], array[:sol]) = public.edhrec_card_priors(array[:c1], array[:sol]));
select chk('a commander with no page is an empty answer, not an error',
  public.edhrec_card_priors(array[:signet], array[:sol]) = '{}'::jsonb);
select chk('more commanders than a Commander deck can have is empty',
  public.edhrec_card_priors(array[:c1, :c2, :sol], array[:sol]) = '{}'::jsonb);
select chk('no commanders is empty', public.edhrec_card_priors('{}'::int[], array[:sol]) = '{}'::jsonb);

-- === who may read what: the reason this function exists ===
set local role anon;
select chk('anon may call the function',
  jsonb_typeof(public.edhrec_card_priors(array[:c1], array[:sol])) = 'object');
select must_fail('anon cannot read the commander pages',
  $q$select 1 from corpus.edhrec_commanders limit 1$q$, 'permission denied');
select must_fail('anon cannot read the card statistics',
  $q$select 1 from corpus.edhrec_commander_cards limit 1$q$, 'permission denied');
reset role;

set local role authenticated;
select chk('a signed-in visitor may call the function too',
  jsonb_typeof(public.edhrec_card_priors(array[:c1], array[:sol])) = 'object');
select must_fail('but still cannot read the card statistics',
  $q$select 1 from corpus.edhrec_commander_cards limit 1$q$, 'permission denied');
reset role;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
