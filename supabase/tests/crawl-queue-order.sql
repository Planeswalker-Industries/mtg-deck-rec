-- Exercises the crawl queue's seed and order: every commander the catalog says is legal is queued, EDHREC's count
-- only orders them, and crawl_next_commanders serves requested, partial, never visited, under target (most played
-- first), then the rest stalest first (a failed visit counting as fresh), leaving out fresh exhausted commanders and cards no longer eligible. Runs in a
-- transaction and rolls back, so it leaves nothing behind. Needs the local catalog.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- A source of its own with known knobs, so the checks see only what they set up.
insert into crawl.state (source) values ('moxfield') on conflict do nothing;
delete from crawl.queue where source = 'moxfield';
update public.app_config
   set value = value || '{"targetDecks": 60, "exhaustedRetryDays": 7, "exhaustedRetrySpreadDays": 7, "notFoundRetryDays": 30, "notFoundGiveUpDays": 300}'::jsonb
 where key = 'moxfield';
delete from public.commander_requests;

create temp table fx (role text primary key, card_id int);
insert into fx
select v.role, (select id from public.cards where slug = v.slug and deleted_at is null)
  from (values
    ('requested_new', 'rofellos-llanowar-emissary'),     -- banned, so not eligible: only a lookup brings it in
    ('requested_fresh', 'derevi-empyrial-tactician'),
    ('partial', 'kraum-ludevics-opus'),
    ('never_most_played', 'tymna-the-weaver'),
    ('never_less_played', 'thrasios-triton-hero'),
    ('under_target', 'ishai-ojutai-dragonspeaker'),
    ('exhausted_stale', 'bruse-tarl-boorish-herder'),
    ('exhausted_fresh', 'vial-smasher-the-fierce'),
    ('stale_less_played', 'silas-renn-seeker-adept'),
    ('stale_most_played', 'akiri-line-slinger'),
    ('fresh_most_played', 'sisay-weatherlight-captain'),
    ('failed_stale', 'kydele-chosen-of-kruphix'),
    ('failed_never', 'ravos-soultender'),
    ('not_a_commander', 'sol-ring'),
    ('banned', 'golos-tireless-pilgrim')
  ) as v (role, slug);
select chk('fixtures resolve', (select bool_and(card_id is not null) from fx),
  (select string_agg(role, ', ') from fx where card_id is null));
select chk('fixture eligibility is what the checks assume',
  (select bool_and(case when role in ('requested_new', 'banned', 'not_a_commander')
                        then not (k.can_be_commander and k.legal_commander = 'legal')
                        else k.can_be_commander and k.legal_commander = 'legal' end)
     from fx join public.cards k on k.id = fx.card_id));

-- One timestamp for both stale commanders, so only EDHREC's count can tell them apart.
select now() - interval '40 days' as stale_at \gset

insert into crawl.queue (source, commander_card_id, outcome, last_visited_at, held_decks, edhrec_deck_count)
select 'moxfield', fx.card_id, v.outcome, v.last_visited_at, v.held_decks, v.edhrec_deck_count
  from (values
    ('requested_fresh', 'done', now() - interval '1 hour', 80, 1),
    ('partial', 'partial', now() - interval '20 days', 70, 1),
    ('never_most_played', null, null, 0, 900),
    ('never_less_played', null, null, 0, 100),
    ('under_target', 'done', now() - interval '1 day', 10, 50),
    ('exhausted_stale', 'exhausted', now(), 10, 20),
    ('exhausted_fresh', 'exhausted', now(), 10, 99999),
    ('stale_less_played', 'done', :'stale_at'::timestamptz, 80, 5),
    ('stale_most_played', 'done', :'stale_at'::timestamptz, 80, 500),
    ('fresh_most_played', 'done', now() - interval '1 day', 80, 10000),
    -- Failed just now (updated_at), however long ago the last full visit was, or with none at all.
    ('failed_stale', 'failed', now() - interval '60 days', 80, 300),
    ('failed_never', 'failed', null, 0, 200),
    ('not_a_commander', null, null, 0, 99999),
    ('banned', null, null, 0, 99999)
  ) as v (role, outcome, last_visited_at, held_decks, edhrec_deck_count)
  join fx on fx.role = v.role;

-- An exhausted commander waits 7 days plus its card id mod 7: one just past its own wait, one an hour short of it.
create or replace function exhausted_wait(p_card int) returns interval
language sql as $$ select make_interval(days => 7 + p_card % 7) $$;
update crawl.queue q set last_visited_at = now() - exhausted_wait(fx.card_id)
                                           - case fx.role when 'exhausted_stale' then interval '1 minute'
                                                          else interval '-1 hour' end
  from fx
 where q.source = 'moxfield' and q.commander_card_id = fx.card_id and fx.role in ('exhausted_stale', 'exhausted_fresh');
select chk('the two exhausted fixtures wait different lengths, so the spread is what decides',
  (select count(distinct exhausted_wait(card_id)) = 2 from fx where role in ('exhausted_stale', 'exhausted_fresh')));

insert into public.commander_requests (commander_card_id, decks_target)
select card_id, 60 from fx where role in ('requested_new', 'requested_fresh');

insert into crawl.runs (source, state) values ('moxfield', 'running') returning id as run1 \gset
select public.crawl_next_commanders('moxfield', :run1, 50) as queue1 \gset

create temp table served as
select fx.role, e.ord, e.q
  from jsonb_array_elements(:'queue1'::jsonb) with ordinality as e (q, ord)
  left join fx on fx.card_id = (e.q ->> 'cardId')::int;

select chk('the queue serves the groups in order, staleness before popularity in the last',
  (select string_agg(role, ' > ' order by ord) from served) =
    'requested_new > requested_fresh > partial > never_most_played > never_less_played > under_target'
    || ' > exhausted_stale > stale_most_played > stale_less_played > fresh_most_played > failed_stale > failed_never',
  (select string_agg(coalesce(role, q ->> 'name'), ' > ' order by ord) from served));
select chk('an exhausted commander waits until its own spread wait has passed',
  not exists (select 1 from served where role = 'exhausted_fresh'));
select chk('a card the catalog does not let lead a deck is skipped, its queue row kept',
  not exists (select 1 from served where role in ('not_a_commander', 'banned'))
    and (select count(*) = 2 from crawl.queue q join fx on fx.card_id = q.commander_card_id
          where q.source = 'moxfield' and fx.role in ('not_a_commander', 'banned')));
select chk('a lookup''s commander is queued and served even when the catalog would skip it',
  exists (select 1 from crawl.queue q join fx on fx.card_id = q.commander_card_id
           where q.source = 'moxfield' and fx.role = 'requested_new'));
select chk('each commander says whether a lookup asked for it',
  (select bool_and((q ->> 'requested')::boolean = (role like 'requested_%')) from served));

-- A lookup for a fresh exhausted commander brings it back at once.
insert into public.commander_requests (commander_card_id, decks_target)
select card_id, 60 from fx where role = 'exhausted_fresh';
select chk('a lookup overrides the exhausted wait',
  exists (select 1 from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run1, 50)) e
           join fx on fx.card_id = (e ->> 'cardId')::int
          where fx.role = 'exhausted_fresh' and (e ->> 'requested')::boolean));
delete from public.commander_requests where commander_card_id = (select card_id from fx where role = 'exhausted_fresh');

-- Once its own wait has passed, the exhausted commander is back, in the under-target group by its count.
update crawl.queue set last_visited_at = now() - exhausted_wait(commander_card_id) - interval '1 minute'
 where source = 'moxfield' and commander_card_id = (select card_id from fx where role = 'exhausted_fresh');
select chk('past its wait, an exhausted commander returns',
  (select (public.crawl_next_commanders('moxfield', :run1, 50) -> 5 ->> 'cardId')::int
     = (select card_id from fx where role = 'exhausted_fresh')),
  public.crawl_next_commanders('moxfield', :run1, 50)::text);

-- The spread puts a day's cohort over a week: every remainder mod 7 holds roughly a seventh of the commanders (locally
-- 477 to 594 of 3,754; hosted's 741 exhausted, 104 to 141).
select chk('the catalog''s commanders fall roughly evenly over the seven extra days',
  (select max(n) < 1.5 * min(n) from (
     select count(*) as n from public.cards
      where can_be_commander and legal_commander = 'legal' and deleted_at is null
      group by id % 7) x));

select chk('a limit takes the head of the order',
  (select jsonb_agg(e ->> 'cardId') from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run1, 3)) e)
    = (select jsonb_agg(e ->> 'cardId') from (
         select e from jsonb_array_elements(public.crawl_next_commanders('moxfield', :run1, 50)) with ordinality x (e, n)
          order by n limit 3) y));

-- === seeding from the catalog ===
delete from public.commander_requests;
delete from crawl.queue where source = 'moxfield'
   and commander_card_id <> (select card_id from fx where role = 'not_a_commander');
delete from corpus.edhrec_commanders;
insert into corpus.edhrec_commanders (slug, commander_1, commander_2, deck_count, fetched_at)
select 'test-tymna', card_id, null, 500, now() from fx where role = 'never_most_played'
union all
select 'test-pair', least(a.card_id, b.card_id), greatest(a.card_id, b.card_id), 50, now()
  from fx a, fx b where a.role = 'never_most_played' and b.role = 'never_less_played';

select count(*) as eligible from public.cards
 where can_be_commander and legal_commander = 'legal' and deleted_at is null \gset
select public.crawl_seed_commanders('moxfield') as seeded \gset
select chk('a first seed queues every commander the catalog says is legal', :seeded = :eligible,
  :seeded || ' of ' || :eligible);
select chk('every one of them is in the queue',
  not exists (select 1 from public.cards k
               where k.can_be_commander and k.legal_commander = 'legal' and k.deleted_at is null
                 and not exists (select 1 from crawl.queue q where q.source = 'moxfield' and q.commander_card_id = k.id)));
select chk('EDHREC''s count sums its pages',
  (select edhrec_deck_count = 550 from crawl.queue q join fx on fx.card_id = q.commander_card_id
    where q.source = 'moxfield' and fx.role = 'never_most_played'));
select chk('a commander on one EDHREC pair page gets that page''s count',
  (select edhrec_deck_count = 50 from crawl.queue q join fx on fx.card_id = q.commander_card_id
    where q.source = 'moxfield' and fx.role = 'never_less_played'));
select chk('a commander EDHREC has no page for is queued with 0',
  (select edhrec_deck_count = 0 from crawl.queue q join fx on fx.card_id = q.commander_card_id
    where q.source = 'moxfield' and fx.role = 'under_target'));
select chk('a queue row for a card no longer eligible stays, unchanged',
  (select edhrec_deck_count = 99999 from crawl.queue q join fx on fx.card_id = q.commander_card_id
    where q.source = 'moxfield' and fx.role = 'not_a_commander'));
select chk('the banned card is not seeded',
  not exists (select 1 from crawl.queue q join fx on fx.card_id = q.commander_card_id
               where q.source = 'moxfield' and fx.role = 'banned'));
select chk('a second seed writes nothing', public.crawl_seed_commanders('moxfield') = 0);
update corpus.edhrec_commanders set deck_count = 600 where slug = 'test-tymna';
select chk('a changed count is the only row rewritten', public.crawl_seed_commanders('moxfield') = 1);

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
