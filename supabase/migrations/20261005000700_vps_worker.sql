-- The VPS worker (T066): one long-running `cli serve` (deploy/worker/) runs on a schedule what used to run by hand,
-- and serves deck lookups through the crawl.
--
-- * app_config.worker: the schedule. Read on every pass, so a change takes effect without a restart.
-- * A commander someone asked for (an active commander_requests row) comes first in the crawl's queue, and joins the
--   queue if the seed list doesn't know it. The worker starts a crawl run when none is going and follows the request
--   through the queue row; the crawl's own politeness, claim and kill switch apply to lookups too.
-- * app_config.commander_requests: how long a lookup waits for the crawl to reach its commander, and how long between
--   attempts to start a crawl for it.

insert into public.app_config (key, value) values (
  'worker',
  jsonb_build_object(
    -- Seconds between passes: lookups, then whatever below is due.
    'pollSeconds', 5,
    -- Start each source's daily crawl at or after this hour (UTC), unless a run already started that day.
    'crawlHourUtc', 10,
    'crawlSources', jsonb_build_array('archidekt'),
    -- Collate this often (a pass with nothing new costs a few index reads and records no run).
    'collateEveryMinutes', 30,
    -- Rebuild the corpus stats at most this often, and only when corpus.decks changed.
    'aggregateEveryHours', 6,
    -- Refetch every EDHREC page this often (about 3.5 hours a fetch) ...
    'edhrecEveryDays', 7,
    -- ... and after a fetch that didn't finish, try again after this long rather than a week later.
    'retryHours', 6
  )
)
on conflict (key) do nothing;

update public.app_config
   set value = value || '{"visitTimeoutMinutes": 90, "crawlTriggerMinutes": 10}'::jsonb, updated_at = now()
 where key = 'commander_requests'
   and (value -> 'visitTimeoutMinutes' is null or value -> 'crawlTriggerMinutes' is null);

-- As in 20261005000200_data_layers.sql, but a commander with an active deck lookup comes first, and one the seed list
-- doesn't know joins the queue so the crawl can reach it at all.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target int := coalesce((select (value->>'targetDecks')::int from public.app_config where key = p_source), 60);
begin
  insert into crawl.queue (source, commander_card_id)
  select distinct p_source, r.commander_card_id
    from public.commander_requests r
   where r.status in ('queued', 'checking', 'collecting')
  on conflict (source, commander_card_id) do nothing;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cardId', q.commander_card_id,
             'oracleId', k.oracle_id,
             'name', k.name,
             'queryName', coalesce(q.query_name, ''),
             'heldDecks', q.held_decks,
             'visited', q.last_visited_at is not null
           ) order by q.requested desc, q.ord, q.edhrec_deck_count desc, q.last_visited_at nulls first, q.commander_card_id),
           '[]'::jsonb)
      from (
        select t.commander_card_id, t.query_name, t.last_visited_at, t.edhrec_deck_count, t.held_decks, a.requested,
               -- Under the target first. Within each group the old order stands: never visited, most played, stalest.
               (t.held_decks >= v_target)::int * 2 + (t.last_visited_at is not null)::int as ord
          from crawl.queue t
          cross join lateral (
            select exists (
              select 1 from public.commander_requests r
               where r.commander_card_id = t.commander_card_id and r.status in ('queued', 'checking', 'collecting')
            ) as requested
          ) a
         where t.source = p_source
           and t.outcome is distinct from 'not_found'
           and t.last_run_id is distinct from p_run_id
         order by a.requested desc, (t.held_decks >= v_target), (t.last_visited_at is not null),
                  t.edhrec_deck_count desc, t.last_visited_at nulls first, t.commander_card_id
         limit p_limit
      ) q
      join public.cards k on k.id = q.commander_card_id
  );
end;
$$;
