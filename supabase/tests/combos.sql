-- Exercises combos, combo_features and combos_for_cards (Commander Spellbook combos): no API role reads them or calls
-- the function, the constraints hold, and the function finds complete and nearly complete combos. Runs in a transaction
-- and rolls back, so it leaves nothing behind. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

select
  (select id from public.cards where slug = 'thassas-oracle' and deleted_at is null) as oracle,
  (select id from public.cards where slug = 'demonic-consultation' and deleted_at is null) as consult,
  (select id from public.cards where slug = 'tainted-pact' and deleted_at is null) as pact,
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as ring
\gset
select chk('fixtures resolve', :oracle is not null and :consult is not null and :pact is not null and :ring is not null);

-- Feature and combo ids far from anything the sync loads, so a loaded database can't collide with them.
insert into public.combo_features (id, name, status) values (-1, 'Test: win the game', 'S'), (-2, 'Test: hidden step', 'H');
insert into public.combos (spellbook_id, card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed)
values
  ('test-consult', array[least(:oracle, :consult), greatest(:oracle, :consult)], '{-2,-1}', 2 | 4, 'R', 0),
  ('test-pact', array[least(:oracle, :pact), greatest(:oracle, :pact)], '{-1}', 2 | 4, 'R', 0);
select id as consult_combo from public.combos where spellbook_id = 'test-consult' \gset
select id as pact_combo from public.combos where spellbook_id = 'test-pact' \gset

-- === combos_for_cards ===
-- Only the test combos: a loaded database also has Spellbook's real ones for these cards.
create temp view found as
  select f.combo_id, f.missing_card_ids, d.label
  from (values ('both', array[:oracle, :consult, :ring]), ('oracle', array[:oracle, :ring]), ('ring', array[:ring])) d (label, deck)
  cross join lateral public.combos_for_cards(d.deck, 1) f
  where f.combo_id in (:consult_combo, :pact_combo);
grant select on found to service_role;

select chk('a deck with every piece completes the combo',
  exists (select 1 from public.combos_for_cards(array[:ring, :consult, :oracle]) where combo_id = :consult_combo and missing_card_ids = '{}'));
select chk('by default, only complete combos come back',
  not exists (select 1 from public.combos_for_cards(array[:oracle, :ring]) where combo_id in (:consult_combo, :pact_combo)));
select chk('one card short names the missing card',
  (select array_agg(missing_card_ids[1] order by combo_id) from found where label = 'oracle') = array[:consult, :pact]);
select chk('a deck holding another piece is one short of the other combo',
  (select missing_card_ids from found where label = 'both' and combo_id = :pact_combo) = array[:pact]);
select chk('a deck holding no piece finds nothing',
  not exists (select 1 from found where label = 'ring'));
select chk('a negative allowance means complete only',
  not exists (select 1 from public.combos_for_cards(array[:oracle], -3) where combo_id in (:consult_combo, :pact_combo)));

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
select must_fail('one row per Spellbook variant',
  format('insert into public.combos (spellbook_id, card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed) values (%L, %L, %L, 0, %L, 0)', 'test-consult', array[:ring], '{}', 'E'),
  'combos_spellbook_id_key');
select must_fail('a combo has at least one card',
  format('insert into public.combos (spellbook_id, card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed) values (%L, %L, %L, 0, %L, 0)', 'test-empty', '{}', '{}', 'E'),
  'check');
select must_fail('commander pieces are pieces of the combo',
  format('insert into public.combos (spellbook_id, card_ids, commander_card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, 0, %L, 0)', 'test-commander', array[:oracle], array[:ring], '{}', 'E'),
  'check');
select must_fail('only Spellbook bracket tags',
  format('insert into public.combos (spellbook_id, card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed) values (%L, %L, %L, 0, %L, 0)', 'test-bracket', array[:ring], '{}', 'X'),
  'check');
select must_fail('colour identity is a five-colour bitmask',
  format('insert into public.combos (spellbook_id, card_ids, feature_ids, color_identity, bracket_tag, mana_value_needed) values (%L, %L, %L, 32, %L, 0)', 'test-identity', array[:ring], '{}', 'E'),
  'check');
select must_fail('only known feature statuses',
  'insert into public.combo_features (id, name, status) values (-3, ''Test'', ''X'')', 'check');

-- === API roles ===
set local role anon;
select must_fail('anon cannot read combos', 'select count(*) from public.combos', 'permission denied');
select must_fail('anon cannot read combo results', 'select count(*) from public.combo_features', 'permission denied');
select must_fail('anon cannot call combos_for_cards', format('select * from public.combos_for_cards(%L)', array[:oracle]), 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read combos', 'select count(*) from public.combos', 'permission denied');
select must_fail('a signed-in user cannot write combos', format('delete from public.combos where id = %s', :consult_combo), 'permission denied');
select must_fail('a signed-in user cannot call combos_for_cards', format('select * from public.combos_for_cards(%L)', array[:oracle]), 'permission denied');
reset role;

set local role service_role;
select chk('service_role reads them and calls the function',
  (select count(*) = 2 from found where label = 'oracle')
  and (select count(*) = 2 from public.combo_features where id in (-1, -2)));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
