-- Three changes to the per-commander crawl: a faster pace that backs itself off, a bound on one commander's work, and
-- a queue that knows what the corpus already holds.
--
-- 1. **Archidekt goes to one request a second** (owner decision 2026-10-03: it has been taking that rate). The reason
--    it was 2.5 s is on the record - one a second drew 429s on 2026-09-14 - so the pace is no longer a fixed guess:
--    the fetcher doubles its interval on a 429, up to `requestIntervalMaxMs`, and returns to the base after
--    `paceRecoverRequests` clean responses. A fixed pace has to be slow enough for the worst day, which means being
--    needlessly slow on every other one. Where the pushback happened is recorded on the run, because a counter says
--    there was resistance and only a position says where to look.
--
-- 2. **A revisit re-reads one page and fetches only what moved**, which is the whole of the "skip decks that have not
--    been updated" optimisation. It replaces a target of 350 new decks per revisit, which made a visit walk up to 40
--    pages - 2,400 deck fetches, hours at the polite pace - hunting decks that, for a commander leading few of the
--    decks its card appears in, were never there. `maxFetchesPerCommander` now bounds the work directly, because a
--    page cap never did.
--
-- 3. **The queue is ordered by need.** It had no idea how many decks it already held per commander, so after the first
--    pass it round-robined by last visit, spending the same effort on a commander with five hundred decks as on one
--    with three. `crawl_commanders.held_decks` is refreshed with the seed at the start of every run, and the order puts
--    commanders under `targetDecks` first.

alter table corpus.crawl_commanders
  add column if not exists held_decks integer not null default 0;

comment on column corpus.crawl_commanders.held_decks is
  'Decks the corpus holds that this commander leads, refreshed by crawl_seed_commanders. The queue serves the commanders furthest from the target first.';

-- A visit that stopped at the fetch cap did what it set out to; it is not a failure and not an exhausted list.
alter table corpus.crawl_commanders drop constraint crawl_commanders_outcome_check;
alter table corpus.crawl_commanders add constraint crawl_commanders_outcome_check
  check (outcome in ('done', 'exhausted', 'page_cap', 'fetch_cap', 'partial', 'not_found', 'no_led_decks', 'failed'));

-- Needy commanders first. The first pass is unaffected - nothing is held yet, so every commander is needy and the
-- order falls back to most-played-first, which is what it was.
-- Schema-qualified: unqualified, `if exists` finds nothing in `corpus` and the create below then collides.
drop index if exists corpus.crawl_commanders_next;
create index crawl_commanders_next
  on corpus.crawl_commanders (source, held_decks, last_visited_at nulls first, seed_decks desc, commander_card_id);

alter table corpus.crawl_runs
  add column if not exists throttles integer not null default 0,
  add column if not exists throttled_position text;

comment on column corpus.crawl_runs.throttled_position is
  'Where the crawl was the last time the source answered 429 ("<commander> page N"). The count says there was resistance; this says where to look.';

-- requestIntervalMs 1000: the pace Archidekt has been taking. The jitter comes down from 500 ms to 200 ms with it -
-- at a 1 s base, half a second of jitter averages 1.25 s, which is not the rate that was asked for. 200 ms keeps the
-- requests off a fixed beat (why the jitter exists) at a tenth of the cost instead of a quarter; set it to 0 for a flat
-- second. requestIntervalMaxMs/paceRecoverRequests are the climb
-- down and back. revisitPages 1 and maxFetchesPerCommander 120 replace newDecksPerRevisit. targetDecks 60 is one
-- page's worth - the first pass's own yield - and it is what the queue measures need against.
update public.app_config
   set value = (value - 'newDecksPerRevisit')
               || '{"requestIntervalMs": 1000, "requestJitterMs": 200, "requestIntervalMaxMs": 8000,
                    "paceRecoverRequests": 60, "revisitPages": 1, "maxFetchesPerCommander": 120,
                    "targetDecks": 60}'::jsonb,
       updated_at = now()
 where key = 'archidekt';

-- Moxfield keeps its own (slower) pace and stays disabled; it only needs the keys that replaced the old ones.
update public.app_config
   set value = (value - 'newDecksPerRevisit')
               || '{"requestIntervalMaxMs": 8000, "paceRecoverRequests": 60,
                    "revisitPages": 1, "maxFetchesPerCommander": 120, "targetDecks": 60}'::jsonb,
       updated_at = now()
 where key = 'moxfield';

-- Adds the commanders EDHREC lists, refreshes their order, and recounts what the corpus holds for each. Diff-only: a
-- row whose seed count and held count are both unchanged is not rewritten. Every run calls it first.
create or replace function public.crawl_seed_commanders(p_source text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with seeds as (
    select c.card_id, sum(e.deck_count)::int as seed_decks
      from public.external_commanders e
      cross join lateral (values (e.commander_1), (e.commander_2)) as c (card_id)
      join public.cards k on k.id = c.card_id and k.deleted_at is null
     where c.card_id is not null
     group by c.card_id
  ),
  held as (
    select k.id as card_id, count(*)::int as held_decks
      from corpus.decks d
      cross join lateral unnest(d.commanders) as o (oracle_id)
      join public.cards k on k.oracle_id::text = o.oracle_id
     where d.source = p_source
     group by k.id
  )
  insert into corpus.crawl_commanders as t (source, commander_card_id, seed_decks, held_decks)
  select p_source, s.card_id, s.seed_decks, coalesce(h.held_decks, 0)
    from seeds s
    left join held h on h.card_id = s.card_id
  on conflict (source, commander_card_id) do update
    set seed_decks = excluded.seed_decks, held_decks = excluded.held_decks, updated_at = now()
    where t.seed_decks is distinct from excluded.seed_decks
       or t.held_decks is distinct from excluded.held_decks;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- The next commanders to visit: the ones furthest from the target first, then never visited, then most played, then
-- least recently visited. Still leaves out anything this run already tried and anything the source has no decks for.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target int := coalesce((select (value->>'targetDecks')::int from public.app_config where key = p_source), 60);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cardId', q.commander_card_id,
             'oracleId', k.oracle_id,
             'name', k.name,
             'queryName', coalesce(q.query_name, ''),
             'heldDecks', q.held_decks,
             'visited', q.last_visited_at is not null
           ) order by q.ord, q.seed_decks desc, q.last_visited_at nulls first, q.commander_card_id), '[]'::jsonb)
      from (
        select t.commander_card_id, t.query_name, t.last_visited_at, t.seed_decks, t.held_decks,
               -- Under the target first. Within each group the old order stands: never visited, most played, stalest.
               (t.held_decks >= v_target)::int * 2 + (t.last_visited_at is not null)::int as ord
          from corpus.crawl_commanders t
         where t.source = p_source
           and t.outcome is distinct from 'not_found'
           and t.last_run_id is distinct from p_run_id
         order by (t.held_decks >= v_target), (t.last_visited_at is not null),
                  t.seed_decks desc, t.last_visited_at nulls first, t.commander_card_id
         limit p_limit
      ) q
      join public.cards k on k.id = q.commander_card_id
  );
end;
$$;

-- Unchanged but for the pushback evidence.
create or replace function public.crawl_finish_run(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_runs set
    state = case when p_summary->>'state' in ('queued', 'running', 'succeeded', 'failed')
                 then p_summary->>'state' else 'failed' end,
    finished_at = now(),
    pages_seen = coalesce((p_summary->>'pages_seen')::int, 0),
    decks_listed = coalesce((p_summary->>'decks_listed')::int, 0),
    decks_fetched = coalesce((p_summary->>'decks_fetched')::int, 0),
    decks_written = coalesce((p_summary->>'decks_written')::int, 0),
    skipped_unchanged = coalesce((p_summary->>'skipped_unchanged')::int, 0),
    skipped_unqualified = coalesce((p_summary->>'skipped_unqualified')::int, 0),
    skipped_missing = coalesce((p_summary->>'skipped_missing')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;
