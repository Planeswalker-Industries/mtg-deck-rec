-- Exercises spellbook.combos and spellbook.features (Commander Spellbook's combos, raw): rows keep Spellbook's own
-- identifiers and values, the constraints hold, and no API role reads them. Runs in a transaction and rolls back, so
-- it leaves nothing behind. Needs nothing loaded: raw doesn't depend on the card catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

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

-- Oracle ids no real card has, and feature ids far from anything the sync loads, so a loaded database can't collide.
\set oa '''00000000-0000-4000-8000-00000000000a'''
\set ob '''00000000-0000-4000-8000-00000000000b'''

insert into spellbook.features (id, name, status) values (-1, 'Test: win the game', 'S'), (-2, 'Test: hidden step', 'H');
insert into spellbook.combos (variant_id, card_oracle_ids, card_names, commander_oracle_ids, feature_ids, bracket_tag,
                              mana_value_needed, edhrec_deck_count, combo_ids)
values ('zz-test-1', array[:oa, :ob]::uuid[], array['Test Oracle', 'Test Consultation'], array[:oa]::uuid[], '{-2,-1}', 'R',
        0, 812, '{9}');

-- === raw keeps what Spellbook published ===
select chk('a combo keeps its oracle ids, names and commander piece',
  (select card_oracle_ids = array[:oa, :ob]::uuid[] and card_names[2] = 'Test Consultation'
          and commander_oracle_ids = array[:oa]::uuid[]
     from spellbook.combos where variant_id = 'zz-test-1'));
select chk('a combo needs no card in our catalog',
  not exists (select 1 from public.cards c join spellbook.combos s on c.oracle_id = any (s.card_oracle_ids)
               where s.variant_id = 'zz-test-1'));
insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed)
values ('zz-test-new-tag', array[:ob]::uuid[], array['Test Consultation'], '{-1}', 'X', 0);
insert into spellbook.features (id, name, status) values (-3, 'Test: a status Spellbook adds later', 'Z');
select chk('a bracket tag or result status Spellbook adds later is stored as published',
  exists (select 1 from spellbook.combos where variant_id = 'zz-test-new-tag' and bracket_tag = 'X')
  and exists (select 1 from spellbook.features where id = -3 and status = 'Z'));
select chk('templates and combo ids default to none',
  (select template_names = '{}' and combo_ids = '{}' from spellbook.combos where variant_id = 'zz-test-new-tag'));

-- === constraints ===
select must_fail('one row per Spellbook variant',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, 0)',
         'zz-test-1', array[:ob]::uuid[], array['Test Consultation'], '{}', 'E'),
  'combos_pkey');
select must_fail('a combo has at least one card',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, 0)',
         'zz-test-empty', '{}', '{}', '{}', 'E'),
  'check');
select must_fail('every card has its name at the same position',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, 0)',
         'zz-test-names', array[:oa, :ob]::uuid[], array['Test Oracle'], '{}', 'E'),
  'combos_card_names_aligned');
select must_fail('commander pieces are pieces of the combo',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, commander_oracle_ids, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, %L, 0)',
         'zz-test-commander', array[:oa]::uuid[], array['Test Oracle'], array[:ob]::uuid[], '{}', 'E'),
  'combos_commander_pieces');
select must_fail('a card is named by its oracle id',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, 0)',
         'zz-test-uuid', '{not-an-oracle-id}', array['Test Oracle'], '{}', 'E'),
  'uuid');
select must_fail('a combo has a bracket tag',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, 0)',
         'zz-test-tag', array[:oa]::uuid[], array['Test Oracle'], '{}', ''),
  'check');
select must_fail('mana needed is never negative',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed) values (%L, %L, %L, %L, %L, -1)',
         'zz-test-mana', array[:oa]::uuid[], array['Test Oracle'], '{}', 'E'),
  'check');
select must_fail('an EDHREC deck count is never negative',
  format('insert into spellbook.combos (variant_id, card_oracle_ids, card_names, feature_ids, bracket_tag, mana_value_needed, edhrec_deck_count) values (%L, %L, %L, %L, %L, 0, -1)',
         'zz-test-count', array[:oa]::uuid[], array['Test Oracle'], '{}', 'E'),
  'check');
select must_fail('a result has a status',
  'insert into spellbook.features (id, name, status) values (-4, ''Test'', '''')', 'check');

-- === API roles ===
set local role anon;
select must_fail('anon cannot read combos', 'select count(*) from spellbook.combos', 'permission denied');
select must_fail('anon cannot read results', 'select count(*) from spellbook.features', 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read combos', 'select count(*) from spellbook.combos', 'permission denied');
select must_fail('a signed-in user cannot write combos', 'delete from spellbook.combos where variant_id = ''zz-test-1''', 'permission denied');
reset role;

set local role service_role;
select chk('service_role reads them',
  (select count(*) = 2 from spellbook.combos where variant_id like 'zz-test-%')
  and (select count(*) = 3 from spellbook.features where id in (-1, -2, -3)));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
