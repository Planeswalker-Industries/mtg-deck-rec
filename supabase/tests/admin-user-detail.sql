-- An admin's view of one account (20261126000200_admin_user_decks.sql): every deck, public or private, comes back;
-- each call writes exactly one audit row; a signed-in player who is not an admin is refused. Runs in a transaction
-- and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-admin@test.invalid', '', now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-player@test.invalid', '', now(), now());
insert into public.platform_admins (user_id, note) values ('aaaaaaaa-0000-4000-8000-0000000000d1', 'test admin');

-- Two cards from the catalog: one leads the decks, one sits in the 99.
select id as commander_card from public.cards order by id limit 1 \gset
select id as main_card from public.cards order by id offset 1 limit 1 \gset

insert into public.decks (id, user_id, name, is_public, commander_1, card_count, updated_at)
values
  ('dddddddd-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Public deck', true, :commander_card, 2, now()),
  ('dddddddd-0000-4000-8000-0000000000d2', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'Private deck', false, :commander_card, 2, now() - interval '1 day');
insert into public.deck_cards (deck_id, card_id, section, quantity)
values
  ('dddddddd-0000-4000-8000-0000000000d1', :main_card, 'main', 1),
  ('dddddddd-0000-4000-8000-0000000000d1', :commander_card, 'commander', 1);

-- === a signed-in player who is not an admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-0000000000d1"}';

do $$ begin
  perform public.admin_user_decks('bbbbbbbb-0000-4000-8000-0000000000d1');
  insert into t values ('non-admin cannot list a user''s decks', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot list a user''s decks', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_deck_cards('dddddddd-0000-4000-8000-0000000000d1');
  insert into t values ('non-admin cannot read a deck''s cards', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot read a deck''s cards', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

-- === the admin ===
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d1"}';

select public.admin_user_decks('bbbbbbbb-0000-4000-8000-0000000000d1') as decks \gset
select chk('both decks come back, private included, newest first',
  jsonb_array_length(:'decks'::jsonb) = 2
  and (:'decks'::jsonb)->0->>'name' = 'Public deck'
  and (:'decks'::jsonb)->1->>'name' = 'Private deck'
  and ((:'decks'::jsonb)->1->>'isPublic')::boolean = false);
select chk('a deck carries its commander ids and card count',
  (:'decks'::jsonb)->0->'commanderIds' = jsonb_build_array(:commander_card)
  and ((:'decks'::jsonb)->0->>'cardCount')::integer = 2);
select chk('no email address in the deck list', position('@' in :'decks') = 0);
do $$ begin perform public.admin_user_decks('bbbbbbbb-0000-4000-8000-0000000000d1'); end $$;

select public.admin_deck_cards('dddddddd-0000-4000-8000-0000000000d1') as cards \gset
select chk('the card list puts the commander first',
  jsonb_array_length(:'cards'::jsonb) = 2
  and (:'cards'::jsonb)->0->>'section' = 'commander'
  and ((:'cards'::jsonb)->0->>'cardId')::integer = :commander_card
  and (:'cards'::jsonb)->1->>'section' = 'main');

-- The audit log is service-role only, so its rows are checked once the test is out of the authenticated role.
reset role;
-- Two admin calls and one refused call: exactly two rows, so a refusal writes none.
select chk('two deck-list calls write two audit rows',
  (select count(*) = 2 from public.audit_log
   where action = 'admin.view_user_decks' and payload->>'user_id' = 'bbbbbbbb-0000-4000-8000-0000000000d1'));
select chk('one deck read writes one audit row naming the deck and its owner',
  (select count(*) = 1 from public.audit_log
   where action = 'admin.view_deck' and payload->>'deck_id' = 'dddddddd-0000-4000-8000-0000000000d1'
     and payload->>'user_id' = 'bbbbbbbb-0000-4000-8000-0000000000d1'
     and actor = 'aaaaaaaa-0000-4000-8000-0000000000d1'));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
