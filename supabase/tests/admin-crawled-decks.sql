-- The admin view of the crawled corpus: readable by a platform admin, refused to everyone else, and never through
-- PostgREST. Runs in a transaction and rolls back, so it leaves nothing behind.
--
-- The point of these checks is the guard. `corpus` holds third-party decklists and is deliberately off PostgREST's
-- exposed schema list; these functions are the single doorway to it, so "a signed-in non-admin gets nothing" is the
-- property that has to keep being true.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'crawl-admin@test.invalid', '', now(), now()),
  ('dddddddd-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'crawl-player@test.invalid', '', now(), now());

create temp table parked as select * from public.platform_admins;
delete from public.platform_admins;
insert into public.platform_admins (user_id, note) values ('dddddddd-0000-4000-8000-000000000001', 'crawl test admin');

-- A deck of the test's own, with a commander the catalog knows so name resolution is actually exercised.
insert into corpus.decks (source, source_deck_id, commanders, cards, deck_size, content_hash, listed_updated_at, last_updated_at)
select 'archidekt', 'zz-admin-test-deck',
       array[(select oracle_id::text from public.cards where deleted_at is null and name = 'Sol Ring' limit 1)],
       jsonb_build_object(
         (select oracle_id::text from public.cards where deleted_at is null and name = 'Sol Ring' limit 1), 1,
         '00000000-0000-4000-8000-00000000dead', 29
       ),
       100, 'zz-admin-test-hash', now(), now();

-- === signed out ===
set local role anon;
do $$
begin
  perform public.admin_crawl_overview();
  perform chk('anon cannot read the crawl overview', false, 'it answered');
exception when others then
  perform chk('anon cannot read the crawl overview', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_list_crawled_decks();
  perform chk('anon cannot list crawled decks', false, 'it answered');
exception when others then
  perform chk('anon cannot list crawled decks', true, sqlerrm);
end;
$$;
reset role;

-- === a signed-in player who is not an admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000002"}';
do $$
begin
  perform public.admin_list_crawled_decks();
  perform chk('a non-admin cannot list crawled decks', false, 'it answered');
exception when others then
  perform chk('a non-admin cannot list crawled decks', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_crawled_deck_cards(1);
  perform chk('a non-admin cannot read a deck''s cards', false, 'it answered');
exception when others then
  perform chk('a non-admin cannot read a deck''s cards', true, sqlerrm);
end;
$$;
-- The schema itself stays unreachable: these functions are the only doorway, not a convenience over an open table.
do $$
begin
  perform 1 from corpus.decks limit 1;
  perform chk('a non-admin cannot read corpus.decks directly', false, 'it answered');
exception when others then
  perform chk('a non-admin cannot read corpus.decks directly', true, sqlerrm);
end;
$$;
reset role;

-- === the admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000001"}';

select chk('an admin sees the crawl overview',
           (select count(*) from public.admin_crawl_overview()) >= 1,
           (select count(*)::text || ' source(s)' from public.admin_crawl_overview()));

select chk('an admin sees the test deck',
           exists (select 1 from public.admin_list_crawled_decks() where source_deck_id = 'zz-admin-test-deck'));

-- Commander oracle ids are resolved to names, because an id on screen tells nobody anything.
select chk('commanders come back as names',
           (select 'Sol Ring' = any(commander_names) from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck')),
           (select array_to_string(commander_names, ', ') from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck')));

select chk('distinct cards counts the keys, not the copies',
           (select distinct_cards = 2 and deck_size = 100 from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck')));

select chk('search finds a deck by its id',
           (select count(*) = 1 from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck')));

select chk('search that matches nothing returns nothing',
           (select count(*) = 0 from public.admin_list_crawled_decks(p_search => 'zzzz-no-such-deck')));

-- The cards, with quantities, and the unknown oracle id kept rather than quietly dropped: a crawl storing an id the
-- catalog has never heard of is the sort of thing this page exists to show.
select chk('a deck''s cards come back with quantities',
           (select count(*) = 2 from public.admin_crawled_deck_cards(
              (select id from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck')))));

select chk('a card the catalog does not know is kept, with a null name',
           (select count(*) = 1 from public.admin_crawled_deck_cards(
              (select id from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck'))) where name is null));

select chk('the quantity is the deck''s, not a count of rows',
           (select quantity = 29 from public.admin_crawled_deck_cards(
              (select id from public.admin_list_crawled_decks(p_search => 'zz-admin-test-deck'))) where name is null));

reset role;

insert into public.platform_admins select * from parked;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
