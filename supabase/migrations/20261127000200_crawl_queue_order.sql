-- The crawl queue is seeded from the catalog and rotates, so every legal commander is crawled and none starves.
--
-- crawl_seed_commanders queues every card the catalog says can lead a Commander deck (can_be_commander, legal,
-- not deleted), not only the commanders EDHREC has a page for. EDHREC's deck count only orders the queue; a commander
-- EDHREC does not know queues with 0. A queue row whose card is no longer eligible stays as history, and the queue
-- skips it unless a deck lookup asks for it.
--
-- crawl_next_commanders serves, in this order: commanders a deck lookup asked for; visits a run's time cut short
-- (partial); never visited; visited but under the deck target, most played first; then everything else, stalest
-- first, with EDHREC's count only breaking ties. An exhausted commander (its list ran out under the target) waits
-- app_config.<source>.exhaustedRetryDays (7) after its last visit, plus 0 to exhaustedRetrySpreadDays - 1 (6) more
-- days set by its card id, so the same few hundred no longer take every run, and a cohort visited on one day (all 741
-- on 2026-11-25) comes back spread over a week instead of filling one run every seventh day.
-- The not_found retry and give-up from 20261127000100_crawl_not_found.sql are unchanged. Each commander now carries
-- requested, so the crawl can tell a lookup's commander from the general queue.

update public.app_config
   set value = value
               || case when value ? 'exhaustedRetryDays' then '{}'::jsonb
                       else jsonb_build_object('exhaustedRetryDays', 7) end
               || case when value ? 'exhaustedRetrySpreadDays' then '{}'::jsonb
                       else jsonb_build_object('exhaustedRetrySpreadDays', 7) end,
       updated_at = now()
 where key = 'archidekt'
   and (not value ? 'exhaustedRetryDays' or not value ? 'exhaustedRetrySpreadDays');

comment on column crawl.queue.edhrec_deck_count is
  'EDHREC''s deck count for the commander, summed over its pages (alone and in pairs); 0 when EDHREC has no page. Orders never-visited and under-target commanders most played first, and breaks ties among the rest. Refreshed by crawl_seed_commanders.';
comment on column crawl.queue.held_decks is
  'Decks the source''s raw table holds that this commander leads, refreshed by crawl_seed_commanders. Commanders under the target are served before those at it.';

-- The queue's order is computed per row (its group, then staleness only in the last group), so no index serves it;
-- the queue holds a few thousand rows and sorts them in a millisecond. The old index only cost writes.
drop index if exists crawl.queue_next;

-- As in 20261005000200_data_layers.sql, but the seeds are the catalog's commanders; EDHREC's count is joined to them.
create or replace function public.crawl_seed_commanders(p_source text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with edhrec as (
    select c.card_id, sum(e.deck_count)::int as edhrec_deck_count
      from corpus.edhrec_commanders e
      cross join lateral (values (e.commander_1), (e.commander_2)) as c (card_id)
     where c.card_id is not null
     group by c.card_id
  ),
  seeds as (
    select k.id as card_id, coalesce(e.edhrec_deck_count, 0) as edhrec_deck_count
      from public.cards k
      left join edhrec e on e.card_id = k.id
     where k.can_be_commander and k.legal_commander = 'legal' and k.deleted_at is null
  ),
  held as (
    select k.id as card_id, count(*)::int as held_decks
      from crawl.decks d
      cross join lateral unnest(d.commanders) as c (oracle_id)
      join public.cards k on k.oracle_id = c.oracle_id
     where d.source = p_source
     group by k.id
  )
  insert into crawl.queue as t (source, commander_card_id, edhrec_deck_count, held_decks)
  select p_source, s.card_id, s.edhrec_deck_count, coalesce(h.held_decks, 0)
    from seeds s
    left join held h on h.card_id = s.card_id
  on conflict (source, commander_card_id) do update
    set edhrec_deck_count = excluded.edhrec_deck_count, held_decks = excluded.held_decks, updated_at = now()
    where t.edhrec_deck_count is distinct from excluded.edhrec_deck_count
       or t.held_decks is distinct from excluded.held_decks;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

-- As in 20261127000100_crawl_not_found.sql, with the order and exclusions described at the top of this file.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Used when app_config sets none. A month between retries keeps a missing commander to a dozen list requests a
  -- year; ten months is long enough for a new card's decks to appear under a name Archidekt indexes late. A week
  -- between visits to an exhausted commander catches its new decks without spending a run's visits on it every day;
  -- spreading the wait over a further week gives each day's run about a seventh of them.
  default_target_decks constant int := 60;
  default_not_found_retry_days constant int := 30;
  default_not_found_give_up_days constant int := 300;
  default_exhausted_retry_days constant int := 7;
  default_exhausted_retry_spread_days constant int := 7;
  -- The queue's groups, served in this order.
  group_partial constant int := 0;
  group_never_visited constant int := 1;
  group_under_target constant int := 2;
  group_rest constant int := 3;
  v_config jsonb := coalesce((select value from public.app_config where key = p_source), '{}'::jsonb);
  v_target int := coalesce((v_config->>'targetDecks')::int, default_target_decks);
  v_retry interval := make_interval(days => coalesce((v_config->>'notFoundRetryDays')::int, default_not_found_retry_days));
  v_give_up interval := make_interval(days => coalesce((v_config->>'notFoundGiveUpDays')::int,
                                                       default_not_found_give_up_days));
  v_exhausted_retry interval := make_interval(days => coalesce((v_config->>'exhaustedRetryDays')::int,
                                                               default_exhausted_retry_days));
  -- At least 1, so the modulo below never divides by zero; 1 means no spread.
  v_exhausted_spread int := greatest(coalesce((v_config->>'exhaustedRetrySpreadDays')::int,
                                              default_exhausted_retry_spread_days), 1);
begin
  insert into crawl.queue (source, commander_card_id)
  select distinct p_source, r.commander_card_id
    from public.commander_requests r
   where r.status in ('queued', 'checking', 'collecting')
  on conflict (source, commander_card_id) do nothing;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cardId', q.commander_card_id,
             'oracleId', q.oracle_id,
             'name', q.name,
             'queryName', coalesce(q.query_name, ''),
             'heldDecks', q.held_decks,
             'visited', q.last_visited_at is not null,
             'requested', q.requested,
             'notFoundSince', q.not_found_since,
             -- Not found again now, the next retry would land past the give-up: this visit is the last.
             'notFoundLastTry', coalesce(q.not_found_since, now()) + v_give_up <= now() + v_retry
           ) order by q.requested desc, q.grp, q.stale_at, q.edhrec_deck_count desc, q.last_visited_at nulls first,
                      q.commander_card_id),
           '[]'::jsonb)
      from (
        select g.*
          from (
            select t.commander_card_id, k.oracle_id, k.name, t.query_name, t.last_visited_at, t.edhrec_deck_count,
                   t.held_decks, t.not_found_since, a.requested,
                   case when t.outcome = 'partial' then group_partial
                        when t.last_visited_at is null then group_never_visited
                        when t.held_decks < v_target then group_under_target
                        else group_rest
                   end as grp,
                   -- Staleness orders only the last group; the others go most played first.
                   case when t.outcome is distinct from 'partial' and t.last_visited_at is not null
                         and t.held_decks >= v_target
                        then t.last_visited_at
                   end as stale_at
              from crawl.queue t
              join public.cards k on k.id = t.commander_card_id
              cross join lateral (
                select exists (
                  select 1 from public.commander_requests r
                   where r.commander_card_id = t.commander_card_id and r.status in ('queued', 'checking', 'collecting')
                ) as requested
              ) a
             where t.source = p_source
               and t.last_run_id is distinct from p_run_id
               and (t.outcome is distinct from 'not_found'
                    or (t.last_visited_at < now() - v_retry
                        and coalesce(t.not_found_since, t.last_visited_at) > now() - v_give_up))
               and (a.requested
                    or (k.can_be_commander and k.legal_commander = 'legal' and k.deleted_at is null
                        and (t.outcome is distinct from 'exhausted' or t.last_visited_at is null
                             or t.last_visited_at <= now() - v_exhausted_retry
                                                     - make_interval(days => t.commander_card_id % v_exhausted_spread))))
          ) g
         order by g.requested desc, g.grp, g.stale_at, g.edhrec_deck_count desc, g.last_visited_at nulls first,
                  g.commander_card_id
         limit p_limit
      ) q
  );
end;
$$;

-- create or replace keeps the grants; restated so this file says who may call them.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crawl_seed_commanders(text)',
    'public.crawl_next_commanders(text, bigint, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
