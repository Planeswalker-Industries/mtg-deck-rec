-- Exercises EDHREC's statistics, resolved (corpus.edhrec_commanders, corpus.edhrec_commander_cards) and raw (the edhrec
-- schema): no API role reads or writes them, the constraints hold, and a commander's card rows go with it. Runs in a
-- transaction and rolls back, so it leaves nothing behind. Needs the local catalog.
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

insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at)
values ('test-pair', :lo, :hi, 100, now())
returning id as pair_id \gset
insert into corpus.edhrec_commander_cards (edhrec_commander_id, card_id, decks_with, potential_decks, synergy)
values (:pair_id, :c1, 90, 100, 0.01), (:pair_id, :c2, 3, 40, null);
select chk('a pair and its card rows are written', (select count(*) = 2 from corpus.edhrec_commander_cards where edhrec_commander_id = :pair_id));

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
  format('insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at) values (%L, %s, %s, 1, now())', 'test-reversed', :hi, :lo),
  'check');
select must_fail('one page per commander pair',
  format('insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at) values (%L, %s, %s, 1, now())', 'test-other-slug', :lo, :hi),
  'edhrec_commanders_pair');
select must_fail('one row per page',
  format('insert into corpus.edhrec_commanders (slug, commander_1, deck_count, fetched_at) values (%L, %s, 1, now())', 'test-pair', :c1),
  'edhrec_commanders_slug_key');
select must_fail('decks_with cannot exceed potential_decks',
  format('insert into corpus.edhrec_commander_cards (edhrec_commander_id, card_id, decks_with, potential_decks) values (%s, %s, 5, 4)', :pair_id, :lo),
  'check');
select must_fail('potential_decks must be positive',
  format('insert into corpus.edhrec_commander_cards (edhrec_commander_id, card_id, decks_with, potential_decks) values (%s, %s, 0, 0)', :pair_id, :lo),
  'check');

-- === API roles ===
set local role anon;
select must_fail('anon cannot read commanders', 'select count(*) from corpus.edhrec_commanders', 'permission denied');
select must_fail('anon cannot read card stats', 'select count(*) from corpus.edhrec_commander_cards', 'permission denied');
select must_fail('anon cannot write', format('delete from corpus.edhrec_commanders where id = %s', :pair_id), 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read commanders', 'select count(*) from corpus.edhrec_commanders', 'permission denied');
select must_fail('a signed-in user cannot read card stats', 'select count(*) from corpus.edhrec_commander_cards', 'permission denied');
reset role;

set local role service_role;
select chk('service_role reads them', (select count(*) = 2 from corpus.edhrec_commander_cards where edhrec_commander_id = :pair_id));
reset role;

-- === cascade ===
delete from corpus.edhrec_commanders where id = :pair_id;
select chk('deleting a commander deletes its card rows', (select count(*) = 0 from corpus.edhrec_commander_cards where edhrec_commander_id = :pair_id));

-- === the raw pages ===
insert into edhrec.commanders (slug, names, deck_count, fetched_at) values ('test-raw', array['Test Commander'], 10, now());
insert into edhrec.commander_cards (slug, name, decks_with, potential_decks) values ('test-raw', 'Sol Ring', 9, 10);
select must_fail('a raw page keeps its counts consistent',
  $q$insert into edhrec.commander_cards (slug, name, decks_with, potential_decks) values ('test-raw', 'Arcane Signet', 11, 10)$q$,
  'check');
select must_fail('a raw page names its commander',
  $q$insert into edhrec.commanders (slug, names, deck_count, fetched_at) values ('test-nameless', '{}', 1, now())$q$,
  'check');
delete from edhrec.commanders where slug = 'test-raw';
select chk('deleting a raw page deletes its card rows', not exists (select 1 from edhrec.commander_cards where slug = 'test-raw'));
set local role anon;
select must_fail('anon cannot read the raw pages', 'select count(*) from edhrec.commanders', 'permission denied');
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
