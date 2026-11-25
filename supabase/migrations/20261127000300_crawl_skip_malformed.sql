-- One bad page costs one deck or one commander, not the run (T107 task 4).
--
-- A deck page that no longer parses is skipped and counted in crawl.runs.skipped_malformed; the run fails only when
-- those pass the same floor and share as missing decks. A commander whose list page fails (an error after the
-- fetcher's retries, or a page that changed shape) ends `failed` and the run moves on; app_config.<source>.
-- maxFailedCommandersInRow (5) failed visits in a row end the run, not counting commanders whose last visit had
-- already failed (crawl_next_commanders says which: failedBefore). The counter reaches /admin/crawls beside the run's
-- other numbers.

alter table crawl.runs add column if not exists skipped_malformed integer not null default 0;

comment on column crawl.runs.skipped_malformed is
  'Decks whose page no longer parsed (the adapter''s ShapeError), skipped one by one. The run fails once they pass the floor and share that also bound missing decks; above zero is worth a look either way.';

update public.app_config
   set value = value || jsonb_build_object('maxFailedCommandersInRow', 5),
       updated_at = now()
 where key = 'archidekt'
   and not value ? 'maxFailedCommandersInRow';

-- As in 20261005000200_data_layers.sql, plus skipped_malformed.
create or replace function public.crawl_finish_run(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.runs set
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
    skipped_unresolved = coalesce((p_summary->>'skipped_unresolved')::int, 0),
    skipped_malformed = coalesce((p_summary->>'skipped_malformed')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;

-- As in 20261126000100_crawl_run_progress.sql, plus skipped_malformed.
create or replace function public.crawl_run_progress(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.runs set
    state = 'running',
    progress_at = now(),
    pages_seen = coalesce((p_summary->>'pages_seen')::int, 0),
    decks_listed = coalesce((p_summary->>'decks_listed')::int, 0),
    decks_fetched = coalesce((p_summary->>'decks_fetched')::int, 0),
    decks_written = coalesce((p_summary->>'decks_written')::int, 0),
    skipped_unchanged = coalesce((p_summary->>'skipped_unchanged')::int, 0),
    skipped_unqualified = coalesce((p_summary->>'skipped_unqualified')::int, 0),
    skipped_missing = coalesce((p_summary->>'skipped_missing')::int, 0),
    skipped_unresolved = coalesce((p_summary->>'skipped_unresolved')::int, 0),
    skipped_malformed = coalesce((p_summary->>'skipped_malformed')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0)
  where id = p_run_id
    and state in ('queued', 'running')
    and finished_at is null;
$$;

-- As in 20261127000200_crawl_queue_order.sql, plus failedBefore: whether the commander's last visit failed. The crawl
-- does not count such a commander toward its failed-commander streak, so a few commanders whose pages always fail,
-- queued side by side, cannot end every run in its first visits.
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
             -- The last visit failed: failing again says something about this commander, not about the source.
             'failedBefore', q.outcome is not distinct from 'failed',
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
                   t.held_decks, t.not_found_since, t.outcome, a.requested,
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
    'public.crawl_finish_run(bigint, jsonb)',
    'public.crawl_run_progress(bigint, jsonb)',
    'public.crawl_next_commanders(text, bigint, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- As in 20261126000100_crawl_run_progress.sql, plus the last run's malformed decks. A RETURNS TABLE change needs a
-- drop; nothing else depends on the function.
drop function public.admin_crawl_overview();

create function public.admin_crawl_overview()
returns table (
  source text,
  decks bigint,
  last_fetched_at timestamptz,
  disabled boolean,
  disabled_reason text,
  probe_ok_at timestamptz,
  running_run_id bigint,
  claimed_at timestamptz,
  last_run_id bigint,
  last_run_state text,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_run_decks_written integer,
  last_run_error text,
  last_run_progress_at timestamptz,
  last_run_commanders_visited integer,
  last_run_throttles integer,
  last_run_skipped_malformed integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();

  return query
  select
    s.source,
    coalesce(d.n, 0) as decks,
    d.newest,
    s.disabled,
    s.disabled_reason,
    s.probe_ok_at,
    s.running_run_id,
    s.claimed_at,
    r.id, r.state, r.started_at, r.finished_at, r.decks_written, r.error,
    r.progress_at, r.commanders_visited, r.throttles, r.skipped_malformed
  from crawl.state s
  -- Every inner reference is aliased: the RETURNS TABLE column names (source, decks, ...) are in scope as plpgsql
  -- variables inside the body, so a bare column of the same name is ambiguous and the function will not run.
  left join lateral (
    select count(*) as n, max(dd.fetched_at) as newest
    from crawl.decks dd where dd.source = s.source
  ) d on true
  left join lateral (
    select cr.id, cr.state, cr.started_at, cr.finished_at, cr.decks_written, cr.error,
           cr.progress_at, cr.commanders_visited, cr.throttles, cr.skipped_malformed
    from crawl.runs cr where cr.source = s.source order by cr.id desc limit 1
  ) r on true
  order by s.source;
end;
$$;

revoke all on function public.admin_crawl_overview() from public, anon;
grant execute on function public.admin_crawl_overview() to authenticated, service_role;
