-- Exercises external_commanders and external_commander_card_stats (EDHREC statistics): no API role reads or writes
-- them, the constraints hold, and a commander's card rows go with it. Runs in a transaction and rolls back, so it leaves
-- nothing behind. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- The "pair" is two non-commanders, so it can never collide with a real page the import already loaded.
select
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as a,
  (select id from public.cards where slug = 'arcane-signet' and deleted_at is null) as b,
  (select id from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'tymna-the-weaver' and deleted_at is null) as c2
\gset
select chk('fixtures resolve', :a is not null and :b is not null and :c1 is not null and :c2 is not null);
select least(:a, :b) as lo, greatest(:a, :b) as hi \gset

insert into public.external_commanders (source, slug, commander_1, commander_2, deck_count, fetched_at)
values ('edhrec', 'test-pair', :lo, :hi, 100, now())
returning id as pair_id \gset
insert into public.external_commander_card_stats (external_commander_id, card_id, decks_with, potential_decks, synergy)
values (:pair_id, :c1, 90, 100, 0.01), (:pair_id, :c2, 3, 40, null);
select chk('a pair and its card rows are written', (select count(*) = 2 from public.external_commander_card_stats where external_commander_id = :pair_id));

-- A statement that must fail, recorded as a check rather than aborting the script.
create or replace function must_fail(p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into t values (p_name, false, 'no error raised');
exception when others then
  insert into t values (p_name, sqlerrm ilike '%' || p_expect || '%', sqlerrm);
end $$;
grant execute on function must_fail(text, text, text) to anon, authenticated, service_role;

-- === constraints ===
select must_fail('commanders must be in ascending order',
  format('insert into public.external_commanders (source, slug, commander_1, commander_2, deck_count, fetched_at) values (%L, %L, %s, %s, 1, now())', 'edhrec', 'test-reversed', :hi, :lo),
  'check');
select must_fail('one page per commander pair and source',
  format('insert into public.external_commanders (source, slug, commander_1, commander_2, deck_count, fetched_at) values (%L, %L, %s, %s, 1, now())', 'edhrec', 'test-other-slug', :lo, :hi),
  'external_commanders_pair');
select must_fail('only known sources',
  format('insert into public.external_commanders (source, slug, commander_1, deck_count, fetched_at) values (%L, %L, %s, 1, now())', 'moxfield', 'test-source', :lo),
  'check');
select must_fail('decks_with cannot exceed potential_decks',
  format('insert into public.external_commander_card_stats (external_commander_id, card_id, decks_with, potential_decks) values (%s, %s, 5, 4)', :pair_id, :lo),
  'check');
select must_fail('potential_decks must be positive',
  format('insert into public.external_commander_card_stats (external_commander_id, card_id, decks_with, potential_decks) values (%s, %s, 0, 0)', :pair_id, :lo),
  'check');

-- === API roles ===
set local role anon;
select must_fail('anon cannot read commanders', 'select count(*) from public.external_commanders', 'permission denied');
select must_fail('anon cannot read card stats', 'select count(*) from public.external_commander_card_stats', 'permission denied');
select must_fail('anon cannot write', format('delete from public.external_commanders where id = %s', :pair_id), 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read commanders', 'select count(*) from public.external_commanders', 'permission denied');
select must_fail('a signed-in user cannot read card stats', 'select count(*) from public.external_commander_card_stats', 'permission denied');
reset role;

set local role service_role;
select chk('service_role reads them', (select count(*) = 2 from public.external_commander_card_stats where external_commander_id = :pair_id));
reset role;

-- === cascade ===
delete from public.external_commanders where id = :pair_id;
select chk('deleting a commander deletes its card rows', (select count(*) = 0 from public.external_commander_card_stats where external_commander_id = :pair_id));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
