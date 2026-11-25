-- A commander the source lists no decks for (outcome not_found) is no longer dropped from the queue for good. It is
-- retried every app_config.<source>.notFoundRetryDays (30) and given up only after notFoundGiveUpDays (300) of not
-- being found. crawl.queue.not_found_since is when the current streak began; any completed visit that finds the
-- commander clears it.
--
-- crawl_next_commanders hands the crawl each commander's notFoundSince and whether this visit is its last try (the
-- next retry would fall past the give-up), so the error ticket a not_found visit opens can say when it began and that
-- the crawl gave up. The two knobs stay in this function alone.

alter table crawl.queue add column not_found_since timestamptz;

comment on column crawl.queue.not_found_since is
  'When the source first listed no decks for this commander in its current not_found streak; null once a visit finds it.';

-- Today's not_found rows started their streak no later than their last visit. Most were last visited in October, so
-- they are due for a retry as soon as this lands.
update crawl.queue
   set not_found_since = coalesce(last_visited_at, now())
 where outcome = 'not_found'
   and not_found_since is null;

update public.app_config
   set value = value
               || case when value ? 'notFoundRetryDays' then '{}'::jsonb
                       else jsonb_build_object('notFoundRetryDays', 30) end
               || case when value ? 'notFoundGiveUpDays' then '{}'::jsonb
                       else jsonb_build_object('notFoundGiveUpDays', 300) end,
       updated_at = now()
 where key = 'archidekt'
   and (not value ? 'notFoundRetryDays' or not value ? 'notFoundGiveUpDays');

-- As in 20261005000700_vps_worker.sql, but a not_found commander comes back once its retry is due, until its streak
-- passes the give-up; and each commander carries notFoundSince and notFoundLastTry.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Used when app_config sets none. A month between retries keeps a missing commander to a dozen list requests a
  -- year; ten months is long enough for a new card's decks to appear under a name Archidekt indexes late.
  default_target_decks constant int := 60;
  default_not_found_retry_days constant int := 30;
  default_not_found_give_up_days constant int := 300;
  v_config jsonb := coalesce((select value from public.app_config where key = p_source), '{}'::jsonb);
  v_target int := coalesce((v_config->>'targetDecks')::int, default_target_decks);
  v_retry interval := make_interval(days => coalesce((v_config->>'notFoundRetryDays')::int, default_not_found_retry_days));
  v_give_up interval := make_interval(days => coalesce((v_config->>'notFoundGiveUpDays')::int,
                                                       default_not_found_give_up_days));
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
             'visited', q.last_visited_at is not null,
             'notFoundSince', q.not_found_since,
             -- Not found again now, the next retry would land past the give-up: this visit is the last.
             'notFoundLastTry', coalesce(q.not_found_since, now()) + v_give_up <= now() + v_retry
           ) order by q.requested desc, q.ord, q.edhrec_deck_count desc, q.last_visited_at nulls first, q.commander_card_id),
           '[]'::jsonb)
      from (
        select t.commander_card_id, t.query_name, t.last_visited_at, t.edhrec_deck_count, t.held_decks,
               t.not_found_since, a.requested,
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
           and (t.outcome is distinct from 'not_found'
                or (t.last_visited_at < now() - v_retry
                    and coalesce(t.not_found_since, t.last_visited_at) > now() - v_give_up))
           and t.last_run_id is distinct from p_run_id
         order by a.requested desc, (t.held_decks >= v_target), (t.last_visited_at is not null),
                  t.edhrec_deck_count desc, t.last_visited_at nulls first, t.commander_card_id
         limit p_limit
      ) q
      join public.cards k on k.id = q.commander_card_id
  );
end;
$$;

-- As in 20261005000200_data_layers.sql, plus the not_found streak: begun by a not_found visit, kept through one that
-- did not complete (partial, failed), cleared by any other.
create or replace function public.crawl_finish_commander(p_source text, p_card_id int, p_run_id bigint, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.queue set
    outcome = p_result->>'outcome',
    last_error = nullif(p_result->>'error', ''),
    query_name = coalesce(nullif(p_result->>'queryName', ''), query_name),
    listed = coalesce((p_result->>'listed')::int, 0),
    fetched = coalesce((p_result->>'fetched')::int, 0),
    written = coalesce((p_result->>'written')::int, 0),
    counted = coalesce((p_result->>'counted')::int, 0),
    wrong_commander = coalesce((p_result->>'wrongCommander')::int, 0),
    last_run_id = p_run_id,
    last_visited_at = case when p_result->>'outcome' in ('partial', 'failed') then last_visited_at else now() end,
    not_found_since = case p_result->>'outcome'
                        when 'not_found' then coalesce(not_found_since, now())
                        when 'partial' then not_found_since
                        when 'failed' then not_found_since
                        else null
                      end,
    updated_at = now()
  where source = p_source and commander_card_id = p_card_id;
$$;

-- create or replace keeps the grants; restated so this file says who may call them.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crawl_next_commanders(text, bigint, int)',
    'public.crawl_finish_commander(text, int, bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
