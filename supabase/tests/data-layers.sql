-- Exercises the data layers (docs/roadmap/card-graph-plan.md, "Data layers"): the raw, crawl and corpus schemas are
-- private, a deck id names one deck across every deck source, crawl.decks shows each deck under its own source, and
-- the collated corpus.decks keeps a player's deck only while the deck exists. Runs in a transaction and rolls back, so
-- it leaves nothing behind. Needs the local catalog.
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

-- === the schemas are private ===
select chk('API roles have no way into the private schemas',
  not exists (
    select 1
      from unnest(array['archidekt', 'moxfield', 'edhrec', 'spellbook', 'crawl', 'corpus']) as s (schema_name)
      cross join unnest(array['anon', 'authenticated']) as r (role_name)
     where has_schema_privilege(r.role_name, s.schema_name, 'usage')),
  (select string_agg(s.schema_name || ':' || r.role_name, ', ')
     from unnest(array['archidekt', 'moxfield', 'edhrec', 'spellbook', 'crawl', 'corpus']) as s (schema_name)
     cross join unnest(array['anon', 'authenticated']) as r (role_name)
    where has_schema_privilege(r.role_name, s.schema_name, 'usage')));
select chk('service_role reaches every one of them',
  (select bool_and(has_schema_privilege('service_role', s, 'usage'))
     from unnest(array['archidekt', 'moxfield', 'edhrec', 'spellbook', 'crawl', 'corpus']) as s));
select chk('nothing third-party is left in public',
  to_regclass('public.external_commanders') is null and to_regclass('public.external_commander_card_stats') is null);
-- The naming rule: a table that holds one source's rows says so in its schema (raw) or its name (corpus), and then
-- carries no source column; a table that mixes sources has a generic name and a source column.
select chk('tables named for one source carry no source column',
  not exists (select 1 from information_schema.columns
               where column_name = 'source'
                 and (table_schema in ('archidekt', 'moxfield', 'edhrec', 'spellbook')
                      or (table_schema = 'corpus' and (table_name like 'edhrec\_%' or table_name like 'spellbook\_%')))),
  (select string_agg(table_schema || '.' || table_name, ', ') from information_schema.columns
    where column_name = 'source'
      and (table_schema in ('archidekt', 'moxfield', 'edhrec', 'spellbook')
           or (table_schema = 'corpus' and (table_name like 'edhrec\_%' or table_name like 'spellbook\_%')))));
select chk('tables that mix sources say which source each row came from',
  (select bool_and(exists (select 1 from information_schema.columns c
                            where c.table_schema = t.schema_name and c.table_name = t.table_name and c.column_name = 'source'))
     from (values ('corpus', 'decks'), ('crawl', 'runs'), ('crawl', 'state'), ('crawl', 'queue'), ('crawl', 'decks'))
          as t (schema_name, table_name)));

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read raw decks', 'select count(*) from archidekt.decks', 'permission denied');
select must_fail('a signed-in user cannot read the collated corpus', 'select count(*) from corpus.decks', 'permission denied');
select must_fail('a signed-in user cannot read the crawl''s view', 'select count(*) from crawl.decks', 'permission denied');
reset role;

-- === raw decks: one id space, each deck under its own source ===
select
  (select oracle_id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1) as osol
\gset

insert into archidekt.decks (source_deck_id, commanders, card_oracle_ids, quantities, deck_size, content_hash, listed_updated_at, last_updated_at)
values ('zz-layers-a', array[:'osol'::uuid], array[:'osol'::uuid], array[1]::smallint[], 100, 'zz-a', now(), now())
returning id as archidekt_id \gset
insert into moxfield.decks (source_deck_id, commanders, card_oracle_ids, quantities, deck_size, content_hash, listed_updated_at, last_updated_at)
values ('zz-layers-a', array[:'osol'::uuid], array[:'osol'::uuid], array[1]::smallint[], 100, 'zz-m', now(), now())
returning id as moxfield_id \gset

select chk('a deck id names one deck whichever source it came from', :archidekt_id <> :moxfield_id);
select chk('crawl.decks shows each deck under its own source',
  (select array_agg(source order by source) from crawl.decks where source_deck_id = 'zz-layers-a')
    = array['archidekt', 'moxfield']);
select chk('a filter on one source reads only that source',
  (select count(*) = 1 from crawl.decks where source = 'moxfield' and source_deck_id = 'zz-layers-a'));
select must_fail('quantities line up with the cards',
  format('insert into archidekt.decks (source_deck_id, commanders, card_oracle_ids, quantities, deck_size, content_hash, listed_updated_at, last_updated_at) values (%L, %L, %L, %L, 100, %L, now(), now())',
         'zz-layers-bad', array[:'osol'::uuid], array[:'osol'::uuid], array[1, 2]::smallint[], 'zz-bad'),
  'check');
select must_fail('a declared bracket is a real bracket',
  format('insert into archidekt.decks (source_deck_id, commanders, card_oracle_ids, quantities, deck_size, declared_bracket, content_hash, listed_updated_at, last_updated_at) values (%L, %L, %L, %L, 100, 6, %L, now(), now())',
         'zz-layers-bracket', array[:'osol'::uuid], array[:'osol'::uuid], array[1]::smallint[], 'zz-bracket'),
  'check');

-- === collated decks ===
select (select id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1) as sol \gset

select must_fail('a crawled deck in the corpus names no player''s deck',
  format('insert into corpus.decks (source, source_deck_id, user_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash) values (%L, %L, gen_random_uuid(), %L, 0, %L, 0, %L, %L)',
         'archidekt', 'zz-layers-a', array[:sol], array[:sol], '2026-10-01', '\x00'),
  'check');
select must_fail('a player''s deck in the corpus names the deck it came from',
  format('insert into corpus.decks (source, source_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash) values (%L, %L, %L, 0, %L, 0, %L, %L)',
         'user', 'zz-layers-user', array[:sol], array[:sol], '2026-10-01', '\x00'),
  'check');
select must_fail('only known sources reach the corpus',
  format('insert into corpus.decks (source, source_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash) values (%L, %L, %L, 0, %L, 0, %L, %L)',
         'edhrec', 'zz-layers-edhrec', array[:sol], array[:sol], '2026-10-01', '\x00'),
  'check');

-- A player's deck leaves the corpus the moment the deck is deleted.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'layers-player@test.invalid', '', now(), now());
insert into public.decks (user_id, name) values ('eeeeeeee-0000-4000-8000-000000000001', 'zz layers deck')
returning id as user_deck \gset
insert into corpus.decks (source, source_deck_id, user_deck_id, commander_card_ids, color_identity, card_ids, basic_lands, updated_month, content_hash)
values ('user', :'user_deck', :'user_deck', array[:sol], 0, array[:sol], 0, '2026-10-01', '\x00');
delete from public.decks where id = :'user_deck';
select chk('deleting a player''s deck removes it from the corpus',
  not exists (select 1 from corpus.decks where source = 'user' and source_deck_id = :'user_deck'));

-- === dirty commanders ===
-- The corpus.decks writes above already queued this commander (collator.sql checks how), so start from a clean slate.
delete from corpus.dirty_commanders where commander_1 = :sol and commander_2 = 0;
insert into corpus.dirty_commanders (commander_1) values (:sol);
select must_fail('a commander is queued once',
  format('insert into corpus.dirty_commanders (commander_1) values (%s)', :sol), 'dirty_commanders_pkey');

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
