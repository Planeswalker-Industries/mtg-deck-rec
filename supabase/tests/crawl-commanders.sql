-- Exercises the per-commander crawl queue (corpus.crawl_commanders and the crawl_* functions around it): seeding from
-- EDHREC's list is diff-only, the queue hands out never-visited commanders first and leaves out the ones a run
-- already finished, a visit's outcome decides whether it counts as visited, a moved listed time is recorded on an
-- unchanged deck, and no API role but service_role reaches any of it. Runs in a transaction and rolls back, so it
-- leaves nothing behind. Needs the local catalog.
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

-- A source of its own, so the checks see only what they set up; the queue starts empty for it.
insert into corpus.crawl_state (source) values ('moxfield') on conflict do nothing;
delete from corpus.crawl_commanders where source = 'moxfield';

-- Two real commanders, and an EDHREC page for the pair as well as each alone, so a seed sums across pages.
select
  (select id from public.cards where slug = 'thrasios-triton-hero' and deleted_at is null) as c1,
  (select id from public.cards where slug = 'tymna-the-weaver' and deleted_at is null) as c2
\gset
select chk('fixtures resolve', :c1 is not null and :c2 is not null);
delete from public.external_commanders;
insert into public.external_commanders (source, slug, commander_1, commander_2, deck_count, fetched_at) values
  ('edhrec', 'test-c1', :c1, null, 500, now()),
  ('edhrec', 'test-c2', :c2, null, 100, now()),
  ('edhrec', 'test-pair', least(:c1, :c2), greatest(:c1, :c2), 50, now());

-- === seeding ===
select chk('a first seed adds every commander', public.crawl_seed_commanders('moxfield') = 2);
select chk('seed_decks sums the pages a commander is on',
  (select seed_decks = 550 from corpus.crawl_commanders where source = 'moxfield' and commander_card_id = :c1));
select chk('a second seed writes nothing', public.crawl_seed_commanders('moxfield') = 0);
update public.external_commanders set deck_count = 900 where slug = 'test-c2';
select chk('a changed count is the only row rewritten', public.crawl_seed_commanders('moxfield') = 1);

-- === the queue ===
insert into corpus.crawl_runs (source, state) values ('moxfield', 'running') returning id as run_id \gset
select chk('most played first',
  (select public.crawl_next_commanders('moxfield', :run_id, 5) -> 0 ->> 'cardId')::int = :c2);
select chk('a queued commander carries its oracle id and is not yet visited',
  (select (q -> 'oracleId') is not null and (q ->> 'visited')::boolean = false
     from (select public.crawl_next_commanders('moxfield', :run_id, 1) -> 0 as q) x));

select public.crawl_finish_commander('moxfield', :c2, :run_id,
  '{"outcome": "done", "queryName": "Tymna the Weaver", "listed": 60, "counted": 40}'::jsonb);
select chk('a finished commander is not handed back to the same run',
  (select jsonb_array_length(public.crawl_next_commanders('moxfield', :run_id, 5)) = 1));
select chk('a complete visit is stamped and its name kept',
  (select last_visited_at is not null and query_name = 'Tymna the Weaver' and counted = 40
     from corpus.crawl_commanders where source = 'moxfield' and commander_card_id = :c2));

select public.crawl_finish_commander('moxfield', :c1, :run_id, '{"outcome": "partial", "listed": 3}'::jsonb);
select chk('a partial visit is not stamped, so it comes back first',
  (select last_visited_at is null from corpus.crawl_commanders where source = 'moxfield' and commander_card_id = :c1));
insert into corpus.crawl_runs (source, state) values ('moxfield', 'running') returning id as run2 \gset
select chk('the next run starts with the unvisited commander',
  (select public.crawl_next_commanders('moxfield', :run2, 5) -> 0 ->> 'cardId')::int = :c1);

select public.crawl_finish_commander('moxfield', :c1, :run2, '{"outcome": "not_found"}'::jsonb);
insert into corpus.crawl_runs (source, state) values ('moxfield', 'running') returning id as run3 \gset
select chk('a commander not found stays out of the queue',
  (select not exists (select 1 from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run3, 5)) e
                       where (e ->> 'cardId')::int = :c1)));
select chk('the status counts the verification log',
  (select (public.crawl_state('moxfield') ->> 'commandersNotFound')::int = 1));
select must_fail('outcomes are a closed list',
  format('update corpus.crawl_commanders set outcome = %L where source = %L', 'maybe', 'moxfield'), 'check');

-- === the queue is ordered by need ===

-- An earlier check marked c1 not_found, which keeps it out of the queue entirely; clear that so this section is about
-- the ordering and nothing else.
update corpus.crawl_commanders set outcome = null, last_run_id = null where source = 'moxfield';

select (value->>'targetDecks')::int as target from public.app_config where key = 'moxfield' \gset

-- Decks the corpus already holds, keyed by the commander that leads them. They go on c2, which an earlier check made
-- the *most played* of the two (900 against 550): need has to beat popularity, and loading the less played commander
-- instead would let this pass for the wrong reason.
insert into corpus.decks (source, source_deck_id, commander_card_ids, cards, deck_size, content_hash, listed_updated_at, last_updated_at)
select 'moxfield', 'zz-held-' || g, array[:c2], jsonb_build_object(:c1::text, 1), 100, 'h-' || g, now(), now()
  from generate_series(1, :target + 5) g;

-- Its own statement, deliberately: a mutating call and a read of what it wrote cannot share a SELECT, because every
-- subquery in one statement sees the snapshot taken before it ran. Asserting in the same select read 0 and looked like
-- a broken count.
select public.crawl_seed_commanders('moxfield') as seeded \gset
select chk('the seed counts what the corpus already holds',
  (select held_decks = :target + 5 from corpus.crawl_commanders
    where source = 'moxfield' and commander_card_id = :c2),
  (select held_decks::text from corpus.crawl_commanders where source = 'moxfield' and commander_card_id = :c2));

insert into corpus.crawl_runs (source, state) values ('moxfield', 'running') returning id as run4 \gset
select chk('a commander over the target yields to one under it, however played it is',
  (select public.crawl_next_commanders('moxfield', :run4, 5) -> 0 ->> 'cardId')::int = :c1,
  public.crawl_next_commanders('moxfield', :run4, 5)::text);

select chk('the queue reports what it holds, so a log line can say why it chose',
  (select (public.crawl_next_commanders('moxfield', :run4, 5) -> 1 ->> 'heldDecks')::int = :target + 5),
  public.crawl_next_commanders('moxfield', :run4, 5)::text);

-- With nothing held they are equally needy and most-played wins again, which is why the first pass is unchanged by any
-- of this: it starts with an empty corpus.
delete from corpus.decks where source = 'moxfield' and source_deck_id like 'zz-held-%';
select public.crawl_seed_commanders('moxfield') as reseeded \gset
select chk('with nothing held, most played leads again',
  (select public.crawl_next_commanders('moxfield', :run4, 5) -> 0 ->> 'cardId')::int = :c2,
  public.crawl_next_commanders('moxfield', :run4, 5)::text);

select public.crawl_finish_commander('moxfield', :c1, :run4, '{"outcome": "fetch_cap", "fetched": 120}'::jsonb);
select chk('fetch_cap is an outcome a visit may record',
  (select outcome = 'fetch_cap' and fetched = 120 from corpus.crawl_commanders
    where source = 'moxfield' and commander_card_id = :c1));

-- === the run records pushback ===
select public.crawl_finish_run(:run4,
  '{"state": "succeeded", "throttles": 4, "throttled_position": "Liesa, Forgotten Archangel page 3"}'::jsonb);
select chk('a run keeps how often the source pushed back, and where it was',
  (select throttles = 4 and throttled_position = 'Liesa, Forgotten Archangel page 3'
     from corpus.crawl_runs where id = :run4));
select chk('a quiet run records no position',
  (select throttled_position is null from corpus.crawl_runs where id = :run_id));

-- === writing decks ===
-- The crawler sends oracle ids, as the source reports them; the database stores card ids. A real commander and a real
-- card, so resolution is exercised.
select
  (select oracle_id::text from public.cards where id = :c1) as oc1,
  (select oracle_id::text from public.cards where deleted_at is null and name = 'Sol Ring' limit 1) as osol,
  (select id from public.cards where deleted_at is null and name = 'Sol Ring' limit 1) as sol
\gset

select public.crawl_upsert_decks('moxfield', jsonb_build_array(jsonb_build_object(
  'source_deck_id', 'test-deck', 'commanders', jsonb_build_array(:'oc1'), 'cards', jsonb_build_object(:'osol', 1),
  'deck_size', 2, 'content_hash', 'h1',
  'listed_updated_at', '2026-09-01T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'))) as first_write \gset
select chk('a new deck is written', (:'first_write'::jsonb ->> 'written')::int = 1, :'first_write');
select chk('it is stored by card id',
  (select commander_card_ids = array[:c1] and cards = jsonb_build_object(:sol::text, 1)
     from corpus.decks where source = 'moxfield' and source_deck_id = 'test-deck'),
  (select commander_card_ids::text || ' ' || cards::text
     from corpus.decks where source = 'moxfield' and source_deck_id = 'test-deck'));
select chk('the same deck written again changes nothing',
  (public.crawl_upsert_decks('moxfield', jsonb_build_array(jsonb_build_object(
    'source_deck_id', 'test-deck', 'commanders', jsonb_build_array(:'oc1'), 'cards', jsonb_build_object(:'osol', 1),
    'deck_size', 2, 'content_hash', 'h1',
    'listed_updated_at', '2026-09-01T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'))) ->> 'written')::int = 0);
select chk('the same cards with a later listed time records the time',
  (public.crawl_upsert_decks('moxfield', jsonb_build_array(jsonb_build_object(
    'source_deck_id', 'test-deck', 'commanders', jsonb_build_array(:'oc1'), 'cards', jsonb_build_object(:'osol', 1),
    'deck_size', 2, 'content_hash', 'h1',
    'listed_updated_at', '2026-09-10T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'))) ->> 'written')::int = 1);
select chk('crawl_deck_versions reads back the hash and the listed time',
  (select v -> 'test-deck' ->> 'hash' = 'h1'
      and (v -> 'test-deck' ->> 'listedUpdatedAt')::timestamptz = '2026-09-10T00:00:00Z'
     from (select public.crawl_deck_versions('moxfield', array['test-deck', 'nope']) as v) x));

-- A deck naming a card the catalog does not have is not stored at all, and comes back with the ids that failed, so the
-- run can count it and the next visit fetches it again. A malformed id is one more id that matches nothing: one bad
-- value must not fail the batch it arrived in.
select public.crawl_upsert_decks('moxfield', jsonb_build_array(
  jsonb_build_object(
    'source_deck_id', 'test-unknown', 'commanders', jsonb_build_array(:'oc1'),
    'cards', jsonb_build_object(:'osol', 1, '00000000-0000-4000-8000-00000000dead', 1),
    'deck_size', 3, 'content_hash', 'h-unknown',
    'listed_updated_at', '2026-09-01T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'),
  jsonb_build_object(
    'source_deck_id', 'test-malformed', 'commanders', jsonb_build_array('not-an-oracle-id'),
    'cards', jsonb_build_object(:'osol', 1),
    'deck_size', 2, 'content_hash', 'h-malformed',
    'listed_updated_at', '2026-09-01T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'),
  jsonb_build_object(
    'source_deck_id', 'test-fine', 'commanders', jsonb_build_array(:'oc1'), 'cards', jsonb_build_object(:'osol', 1),
    'deck_size', 2, 'content_hash', 'h-fine',
    'listed_updated_at', '2026-09-01T00:00:00Z', 'last_updated_at', '2026-09-01T00:00:00Z'))) as mixed \gset
select chk('a deck with an unknown card is not stored',
  not exists (select 1 from corpus.decks
               where source = 'moxfield' and source_deck_id in ('test-unknown', 'test-malformed')));
select chk('the rest of the batch is',
  (:'mixed'::jsonb ->> 'written')::int = 1
    and exists (select 1 from corpus.decks where source = 'moxfield' and source_deck_id = 'test-fine'),
  :'mixed');
select chk('the unresolved decks come back with the ids that failed',
  (:'mixed'::jsonb -> 'unresolved')
    @> '[{"deckId": "test-unknown", "missing": ["00000000-0000-4000-8000-00000000dead"]},
         {"deckId": "test-malformed", "missing": ["not-an-oracle-id"]}]'::jsonb
    and jsonb_array_length(:'mixed'::jsonb -> 'unresolved') = 2,
  :'mixed');

select public.crawl_finish_run(:run4, '{"state": "succeeded", "skipped_unresolved": 2}'::jsonb);
select chk('a run records how many decks it could not resolve',
  (select skipped_unresolved = 2 from corpus.crawl_runs where id = :run4));

-- === API roles ===
set local role anon;
select must_fail('anon cannot seed', $q$select public.crawl_seed_commanders('moxfield')$q$, 'permission denied');
select must_fail('anon cannot read the queue', $q$select public.crawl_next_commanders('moxfield', 1, 1)$q$, 'permission denied');
select must_fail('anon cannot finish a commander',
  $q$select public.crawl_finish_commander('moxfield', 1, 1, '{}'::jsonb)$q$, 'permission denied');
select must_fail('anon cannot read held decks', $q$select public.crawl_deck_versions('moxfield', array['x'])$q$, 'permission denied');
select must_fail('anon cannot write decks', $q$select public.crawl_upsert_decks('moxfield', '[]'::jsonb)$q$, 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
select must_fail('a signed-in user cannot read the queue', $q$select public.crawl_next_commanders('moxfield', 1, 1)$q$, 'permission denied');
reset role;

set local role service_role;
select chk('service_role reads the queue', (select jsonb_typeof(public.crawl_next_commanders('moxfield', 0, 1)) = 'array'));
reset role;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
