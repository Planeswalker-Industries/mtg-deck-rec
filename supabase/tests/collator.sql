-- Exercises what the collator (T054) relies on in the database: corpus.decks queues its commanders for the precompute
-- worker on every write, a player deleting their own deck cascades out of the corpus without access to it,
-- corpus.spellbook_combos and corpus.collate_state hold their shape and stay private, and the settings are in place.
-- Runs in a transaction and rolls back, so it leaves nothing behind. Needs the local catalog.
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
  (select id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1) as sol,
  (select id from public.cards where deleted_at is null and name = 'Liesa, Forgotten Archangel' limit 1) as liesa,
  (select id from public.cards where deleted_at is null and name = 'Tymna the Weaver' limit 1) as tymna,
  (select id from public.cards where deleted_at is null and name = 'Thrasios, Triton Hero' limit 1) as thrasios
\gset
select chk('fixtures resolve', :sol is not null and :liesa is not null and :tymna is not null and :thrasios is not null);

-- Only the rows these checks write, so a database with a real queue still checks cleanly.
delete from corpus.dirty_commanders;

-- === corpus.decks queues its commanders ===
insert into corpus.decks (source, source_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash)
values
  ('archidekt', 'zz-collator-a', array[:liesa], 5, array[:sol], 30, '2026-10-01', '\x01'),
  ('archidekt', 'zz-collator-b', array[:liesa], 5, array[:sol], 31, '2026-10-01', '\x02'),
  ('archidekt', 'zz-collator-c', array[least(:tymna, :thrasios), greatest(:tymna, :thrasios)], 31, array[:sol], 30, '2026-10-01', '\x03');
select chk('a write queues each commander and pair once',
  (select count(*) from corpus.dirty_commanders) = 2
  and exists (select 1 from corpus.dirty_commanders where commander_1 = :liesa and commander_2 = 0)
  and exists (select 1 from corpus.dirty_commanders
               where commander_1 = least(:tymna, :thrasios) and commander_2 = greatest(:tymna, :thrasios)));

select seq as liesa_seq from corpus.dirty_commanders where commander_1 = :liesa \gset
update corpus.decks set commander_card_ids = array[:tymna, :thrasios]::integer[], color_identity = 31
 where source = 'archidekt' and source_deck_id = 'zz-collator-a';
select chk('an update queues the deck''s old commander again',
  (select seq from corpus.dirty_commanders where commander_1 = :liesa) > :liesa_seq);

delete from corpus.dirty_commanders;
delete from corpus.decks where source = 'archidekt' and source_deck_id = 'zz-collator-b';
select chk('a removal queues the deck''s commander',
  exists (select 1 from corpus.dirty_commanders where commander_1 = :liesa and commander_2 = 0));

-- === a player's deck leaves the corpus with the deck ===
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('eeeeeeee-0000-4000-8000-000000000054', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'collator-player@test.invalid', '', now(), now());
insert into public.decks (user_id, name) values ('eeeeeeee-0000-4000-8000-000000000054', 'zz collator deck')
returning id as player_deck \gset
insert into corpus.decks (source, source_deck_id, user_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash)
values ('user', :'player_deck', :'player_deck', array[:liesa], 5, array[:sol], 30, '2026-10-01', '\x04');
delete from corpus.dirty_commanders;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000054","role":"authenticated"}';
delete from public.decks where id = :'player_deck';
reset role;
select chk('a player deleting their own deck takes it out of the corpus',
  not exists (select 1 from corpus.decks where source = 'user' and source_deck_id = :'player_deck'));
select chk('and queues its commander, though the player can''t reach corpus',
  exists (select 1 from corpus.dirty_commanders where commander_1 = :liesa and commander_2 = 0));

-- === corpus.spellbook_combos ===
insert into corpus.spellbook_combos (variant_id, card_ids, commander_card_ids, results, min_bracket, color_identity, mana_value_needed)
values ('zz-collator-combo', array[:sol, :liesa], array[:liesa], array['Test: win the game'], 4, 5, 0);
select chk('a collated combo keeps its pieces, commander piece and results',
  (select card_ids = array[:sol, :liesa] and results = array['Test: win the game'] and contextual_results = '{}'
     from corpus.spellbook_combos where variant_id = 'zz-collator-combo'));
select must_fail('commander pieces are pieces of the combo',
  format('insert into corpus.spellbook_combos (variant_id, card_ids, commander_card_ids, min_bracket, color_identity, mana_value_needed) values (%L, %L, %L, 2, 0, 0)',
         'zz-collator-bad', array[:sol], array[:liesa]),
  'spellbook_combos_commander_pieces');
select must_fail('a minimum bracket is a real bracket',
  format('insert into corpus.spellbook_combos (variant_id, card_ids, min_bracket, color_identity, mana_value_needed) values (%L, %L, 6, 0, 0)',
         'zz-collator-bracket', array[:sol]),
  'check');
select must_fail('a combo has pieces',
  format('insert into corpus.spellbook_combos (variant_id, card_ids, min_bracket, color_identity, mana_value_needed) values (%L, %L, 2, 0, 0)',
         'zz-collator-empty', '{}'),
  'check');

-- === corpus.collate_state ===
select must_fail('collation state is kept per known source',
  'insert into corpus.collate_state (source, catalog_epoch) values (''scryfall'', 1)', 'check');

-- === private ===
set local role anon;
select must_fail('anon cannot read collated combos', 'select count(*) from corpus.spellbook_combos', 'permission denied');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read collation state', 'select count(*) from corpus.collate_state', 'permission denied');
select must_fail('a signed-in user cannot run the dirty-commander trigger function',
  'select corpus.mark_commanders_dirty()', 'permission denied');
reset role;
set local role service_role;
select chk('service_role reads both', (select count(*) = 1 from corpus.spellbook_combos where variant_id = 'zz-collator-combo')
  and (select count(*) >= 0 from corpus.collate_state));
reset role;

-- === settings ===
select chk('minDecks and fullDecks are both 50',
  (select (value ->> 'minDecks')::int = 50 and (value ->> 'fullDecks')::int = 50 from public.app_config where key = 'corpus'));
select chk('the collator''s removal gate is configured',
  (select (value ->> 'collateMaxRemovedShare')::real between 0 and 1 from public.app_config where key = 'corpus'));
select chk('EDHREC has a polite pace and is switched on',
  (select (value ->> 'requestIntervalMs')::int >= 1000 and value ->> 'disabledReason' is null from public.app_config where key = 'edhrec'));
select chk('collation and EDHREC page fetches have their own sync jobs',
  'corpus_collate' = any (enum_range(null::public.sync_job)::text[]) and 'edhrec_pages' = any (enum_range(null::public.sync_job)::text[]));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
