-- Crawl runs report progress while they run, and a run whose process died is closed rather than left open (T106
-- task 1, T074).
--
-- Before this, a run's row said `queued` with zero counters for the whole six-hour crawl: the counters were written
-- once, by crawl_finish_run, at the end. A container killed by a redeploy never got there, so its row stayed `queued`
-- for ever; a panic did reach the deferred finish, but with the summary still saying `running`, which wrote a
-- `running` row with a finished_at. The crawl now writes its counters after the claim and after every commander,
-- and sweeps its source's abandoned rows before it starts.

alter table crawl.runs add column if not exists progress_at timestamptz;

comment on column crawl.runs.progress_at is
  'When the run last reported progress (crawl_run_progress): after its claim and after every commander visit. A queued or running row whose progress stopped longer ago than the stale-claim window is closed by the next run''s sweep (crawl_close_stale_runs).';

-- The same counters crawl_finish_run writes, on a run that is still open. It never reopens a finished run: a late
-- progress write racing the finish must not turn a closed row back into `running`.
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
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0)
  where id = p_run_id
    and state in ('queued', 'running')
    and finished_at is null;
$$;

-- Closes the source's runs that no live process owns: open rows whose last sign of life is older than the stale
-- window, except the one the source's fresh claim points at, and `running` rows that already have a finished_at (what
-- a panic wrote before the crawl turned a leftover `running` into `failed`). Returns how many it closed.
create or replace function public.crawl_close_stale_runs(p_source text, p_stale_after_seconds int)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := make_interval(secs => greatest(p_stale_after_seconds, 0));
  v_live_run bigint;
  v_abandoned integer := 0;
  v_unfinished integer := 0;
begin
  -- The run a fresh claim points at is alive by definition, however quiet: crawl_claim would refuse to take it over.
  select s.running_run_id into v_live_run
    from crawl.state s
   where s.source = p_source
     and s.running_run_id is not null
     and s.claimed_at > now() - v_window;

  update crawl.runs r
     set state = 'failed',
         finished_at = now(),
         error = coalesce(nullif(r.error, ''),
                          format('abandoned: no progress for %s min', greatest(p_stale_after_seconds, 0) / 60))
   where r.source = p_source
     and r.state in ('queued', 'running')
     and r.finished_at is null
     and r.id is distinct from v_live_run
     and coalesce(r.progress_at, r.started_at) < now() - v_window;
  get diagnostics v_abandoned = row_count;

  update crawl.runs r
     set state = 'failed',
         error = coalesce(nullif(r.error, ''), 'interrupted')
   where r.source = p_source
     and r.state = 'running'
     and r.finished_at is not null;
  get diagnostics v_unfinished = row_count;

  return v_abandoned + v_unfinished;
end;
$$;

-- Only the crawl's own role, as for the other crawl_* functions (20260922000300_deck_crawl_corpus.sql).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crawl_run_progress(bigint, jsonb)',
    'public.crawl_close_stale_runs(text, int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- The overview gains the last run's progress, so /admin/crawls can show a running crawl's commanders, decks and last
-- sign of life. A RETURNS TABLE change needs a drop; nothing else depends on the function.
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
  last_run_throttles integer
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
    r.progress_at, r.commanders_visited, r.throttles
  from crawl.state s
  -- Every inner reference is aliased: the RETURNS TABLE column names (source, decks, ...) are in scope as plpgsql
  -- variables inside the body, so a bare column of the same name is ambiguous and the function will not run.
  left join lateral (
    select count(*) as n, max(dd.fetched_at) as newest
    from crawl.decks dd where dd.source = s.source
  ) d on true
  left join lateral (
    select cr.id, cr.state, cr.started_at, cr.finished_at, cr.decks_written, cr.error,
           cr.progress_at, cr.commanders_visited, cr.throttles
    from crawl.runs cr where cr.source = s.source order by cr.id desc limit 1
  ) r on true
  order by s.source;
end;
$$;

revoke all on function public.admin_crawl_overview() from public, anon;
grant execute on function public.admin_crawl_overview() to authenticated, service_role;
