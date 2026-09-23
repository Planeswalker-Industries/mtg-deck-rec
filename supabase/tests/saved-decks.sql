-- Exercises the saved-deck functions, above all that one user cannot reach another's decks.
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.invalid', '', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.invalid', '', now(), now());

select
  (select id from public.cards where slug = 'liesa-forgotten-archangel' and deleted_at is null) as cmd,
  (select id from public.cards where slug = 'sol-ring' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'arcane-signet' and deleted_at is null) as c2
\gset
select chk('fixtures resolve', :cmd is not null and :c1 is not null and :c2 is not null);

-- === user A ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

select public.save_deck(
  null,
  '  My  Liesa Deck' || chr(9) || chr(7),
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main'),
    jsonb_build_object('cardId', :c2, 'quantity', 1, 'section', 'main')
  ),
  3::smallint
) as deck_a
\gset

select chk('save_deck returns an id', :'deck_a' <> '');
select chk('control chars and padding stripped from name',
  (select name = 'My  Liesa Deck' from public.decks where id = :'deck_a'),
  (select name from public.decks where id = :'deck_a'));
select chk('public by default', (select is_public from public.decks where id = :'deck_a'));
select chk('commander denormalised', (select commander_1 = :cmd and commander_2 is null from public.decks where id = :'deck_a'));
select chk('card_count counted', (select card_count = 3 from public.decks where id = :'deck_a'));
select chk('legal deck feeds corpus', (select include_in_corpus from public.decks where id = :'deck_a'));
select chk('colour identity set', (select color_identity > 0 from public.decks where id = :'deck_a'));
select chk('cards stored', (select count(*) = 3 from public.deck_cards where deck_id = :'deck_a'));

-- Re-saving identical cards must not churn rows.
create temp table before_save as select card_id, section, quantity from public.deck_cards where deck_id = :'deck_a';
grant all on before_save to authenticated;
select public.save_deck(:'deck_a', 'Renamed On Save',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main'),
    jsonb_build_object('cardId', :c2, 'quantity', 1, 'section', 'main')
  ), null);
select chk('re-save leaves card rows identical',
  (select count(*) = 0 from (
    (select * from before_save except select card_id, section, quantity from public.deck_cards where deck_id = :'deck_a')
    union all
    (select card_id, section, quantity from public.deck_cards where deck_id = :'deck_a' except select * from before_save)
  ) diff));
select chk('bracket kept when null passed', (select bracket = 3 from public.decks where id = :'deck_a'));

select public.save_deck(:'deck_a', 'Fewer Cards',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main')
  ), null);
select chk('removing a card drops its row', (select count(*) = 2 from public.deck_cards where deck_id = :'deck_a'));

select public.save_deck(:'deck_a', 'With A Bogus Card',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', 2147483600, 'quantity', 1, 'section', 'main')
  ), null);
select chk('unknown card id ignored, not an error', (select count(*) = 1 from public.deck_cards where deck_id = :'deck_a'));

-- The deckbuilder once sent each commander twice, and one upsert cannot touch a row twice.
select public.save_deck(:'deck_a', 'Repeated Rows',
  jsonb_build_array(
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :cmd, 'quantity', 1, 'section', 'commander'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main'),
    jsonb_build_object('cardId', :c1, 'quantity', 1, 'section', 'main')
  ), null);
select chk('repeated rows fold into one per card and section',
  (select count(*) = 2 and sum(quantity) filter (where section = 'commander') = 1 and sum(quantity) filter (where section = 'main') = 2
   from public.deck_cards where deck_id = :'deck_a'));

do $$ begin
  perform public.save_deck(null, '   ', '[]'::jsonb, null);
  insert into t values ('blank name refused', false, 'no error raised');
exception when others then
  insert into t values ('blank name refused', sqlerrm like '%DECK_NAME_REQUIRED%', sqlerrm);
end $$;

select public.rename_deck(:'deck_a', 'Final Name');
select chk('rename works', (select name = 'Final Name' from public.decks where id = :'deck_a'));

select public.set_deck_visibility(:'deck_a', false);
select chk('visibility toggles', (select is_public = false from public.decks where id = :'deck_a'));
select chk('private deck still feeds corpus', (select include_in_corpus from public.decks where id = :'deck_a'));

select public.duplicate_deck(:'deck_a', null) as deck_copy \gset
select chk('duplicate creates a second deck', (select count(*) = 2 from public.decks where user_id = '11111111-1111-1111-1111-111111111111'));
select chk('duplicate copies the cards',
  (select count(*) from public.deck_cards where deck_id = :'deck_copy') = (select count(*) from public.deck_cards where deck_id = :'deck_a'));
select chk('duplicate is named a copy', (select name like '%(copy)' from public.decks where id = :'deck_copy'),
  (select name from public.decks where id = :'deck_copy'));

-- === user B must not reach user A's private deck ===
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';

create temp table ids as select :'deck_a'::uuid as a, :'deck_copy'::uuid as c;
grant all on ids to authenticated, anon;
select chk('B cannot read A''s private deck', (select count(*) = 0 from public.decks where id = :'deck_a'));
select chk('B cannot read A''s deck cards', (select count(*) = 0 from public.deck_cards where deck_id = :'deck_a'));

do $$
declare a uuid := (select ids.a from ids);
begin
  begin perform public.rename_deck(a, 'Hijacked');
    insert into t values ('B cannot rename A''s deck', false, 'no error raised');
  exception when others then insert into t values ('B cannot rename A''s deck', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm); end;

  begin perform public.set_deck_visibility(a, true);
    insert into t values ('B cannot expose A''s deck', false, 'no error raised');
  exception when others then insert into t values ('B cannot expose A''s deck', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm); end;

  begin perform public.duplicate_deck(a, null);
    insert into t values ('B cannot duplicate A''s deck', false, 'no error raised');
  exception when others then insert into t values ('B cannot duplicate A''s deck', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm); end;

  begin perform public.save_deck(a, 'Overwritten', '[]'::jsonb, null);
    insert into t values ('B cannot overwrite A''s deck', false, 'no error raised');
  exception when others then insert into t values ('B cannot overwrite A''s deck', sqlerrm like '%DECK_NOT_FOUND%', sqlerrm); end;
end $$;

delete from public.decks where id = :'deck_a';
set local role postgres;
select chk('B''s delete removed nothing', (select count(*) = 1 from public.decks where id = :'deck_a'));
set local role authenticated;

-- A public deck of A's IS visible to B and to anon.
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select public.set_deck_visibility(:'deck_copy', true);
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222"}';
select chk('B can read A''s public deck', (select count(*) = 1 from public.decks where id = :'deck_copy'));
select chk('B can read its cards', (select count(*) > 0 from public.deck_cards where deck_id = :'deck_copy'));

set local role anon;
select chk('anon sees the public deck', (select count(*) = 1 from public.decks where id = :'deck_copy'));
select chk('anon cannot see the private one', (select count(*) = 0 from public.decks where id = :'deck_a'));
do $$ begin
  perform public.save_deck(null, 'Anon Deck', '[]'::jsonb, null);
  insert into t values ('anon cannot save a deck', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot save a deck', true, sqlerrm);
end $$;

-- The per-account cap, checked by lowering it rather than making a hundred decks.
reset role;
update public.app_config set value = value || '{"maxDecks": 2}'::jsonb where key = 'decks';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$ begin
  perform public.save_deck(null, 'Third Deck', '[]'::jsonb, null);
  insert into t values ('cap refuses a new deck past maxDecks', false, 'no error raised');
exception when others then
  insert into t values ('cap refuses a new deck past maxDecks', sqlerrm like '%TOO_MANY_DECKS%', sqlerrm);
end $$;
do $$
declare c uuid := (select ids.c from ids);
begin
  perform public.duplicate_deck(c, null);
  insert into t values ('cap refuses a duplicate past maxDecks', false, 'no error raised');
exception when others then
  insert into t values ('cap refuses a duplicate past maxDecks', sqlerrm like '%TOO_MANY_DECKS%', sqlerrm);
end $$;
do $$
declare c uuid := (select ids.c from ids);
begin
  perform public.save_deck(c, 'Still Editable At The Cap', '[]'::jsonb, null);
  insert into t values ('cap still allows editing an existing deck', true, '');
exception when others then
  insert into t values ('cap still allows editing an existing deck', false, sqlerrm);
end $$;

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
