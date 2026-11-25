-- Two additions to the admin home, both owner requests on 2026-11-25:
--
--  * Run now: an admin asks the worker to run one of its duties (a collation, the nightly baseline, the scores, the
--    corpus's card pairs, an EDHREC fetch, or a source's crawl) without waiting for its schedule. The web app can't
--    reach the worker, so the ask is a row here; the worker's loop (every few seconds) marks it picked and runs the
--    duty. One waiting ask per duty: asking again while one waits changes nothing.
--  * Journeys started: how often the deck tool's journey starts, from a pasted deck or a commander's build. Counters
--    only, never an event log: an hourly site-wide count (signed in or not) and a running count per account. Written
--    only through the server (service role), behind the visitor's rate limit.

-- ---------------------------------------------------------------------------
-- Run now
-- ---------------------------------------------------------------------------

create table public.worker_requests (
  id bigint generated always as identity primary key,
  -- A worker duty, or 'crawl:<source>' for a crawl source's run.
  duty text not null check (duty ~ '^(collate|baseline|scores|global_pairs|edhrec|crawl:[a-z]+)$'),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- Set by the worker when it takes the ask; null while it waits.
  picked_at timestamptz
);

-- One waiting ask per duty, and the worker's "what is waiting" read is this index.
create unique index worker_requests_one_waiting on public.worker_requests (duty) where picked_at is null;

-- Read and written only by the admin functions below and by the worker (which connects as the table owner).
alter table public.worker_requests enable row level security;
revoke all on public.worker_requests from anon, authenticated;

-- Asks the worker to run a duty now. Returns the waiting ask, new or already there. A crawl source must exist and be
-- switched on: the crawl itself refuses a disabled source, and the button should not pretend otherwise.
create or replace function public.admin_request_worker_run(p_duty text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_source text;
  v_row public.worker_requests;
begin
  if p_duty is null or p_duty !~ '^(collate|baseline|scores|global_pairs|edhrec|crawl:[a-z]+)$' then
    raise exception 'Unknown worker duty.' using errcode = '23514';
  end if;

  if p_duty like 'crawl:%' then
    v_source := substr(p_duty, length('crawl:') + 1);
    if not exists (select 1 from crawl.state s where s.source = v_source and not s.disabled) then
      raise exception 'That crawl source is switched off or unknown.' using errcode = '23514';
    end if;
  end if;

  insert into public.worker_requests (duty, requested_by)
  values (p_duty, v_actor)
  on conflict (duty) where picked_at is null do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.worker_requests r where r.duty = p_duty and r.picked_at is null;
  else
    insert into public.audit_log (actor, action, payload)
    values (v_actor, 'admin.request_worker_run', jsonb_build_object('duty', p_duty, 'request_id', v_row.id));
  end if;

  return jsonb_build_object('duty', v_row.duty, 'requestedAt', v_row.requested_at);
end;
$$;

revoke execute on function public.admin_request_worker_run(text) from public, anon;
grant execute on function public.admin_request_worker_run(text) to authenticated, service_role;

-- What the admin home needs to say when each duty runs next: the worker's schedule (app_config.worker; the worker
-- fills any missing key with its default), the asks still waiting, the last start and last success of each scheduled
-- job, and each crawl source's last start. Every read is a small table or the sync_runs_job_recent index.
create or replace function public.admin_worker_schedule()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_jobs jsonb;
begin
  perform public.require_platform_admin();

  select coalesce(jsonb_object_agg(j.job, jsonb_build_object(
           'lastStartedAt', (select max(r.started_at) from public.sync_runs r where r.job = j.job::public.sync_job),
           'lastSucceededAt', (select max(r.started_at) from public.sync_runs r
                               where r.job = j.job::public.sync_job and r.status = 'succeeded')
         )), '{}'::jsonb)
    into v_jobs
    from unnest(array['corpus_collate', 'precompute_baseline', 'precompute_scores', 'precompute_global_pairs', 'edhrec_pages']) as j (job);

  return jsonb_build_object(
    'schedule', coalesce((select c.value from public.app_config c where c.key = 'worker'), '{}'::jsonb),
    'jobs', v_jobs,
    'crawls', coalesce((
      select jsonb_object_agg(s.source, jsonb_build_object(
               'disabled', s.disabled,
               'lastStartedAt', (select max(r.started_at) from crawl.runs r where r.source = s.source)
             ))
        from crawl.state s
    ), '{}'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object('duty', r.duty, 'requestedAt', r.requested_at) order by r.requested_at)
        from public.worker_requests r
       where r.picked_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_worker_schedule() from public, anon;
grant execute on function public.admin_worker_schedule() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Journeys started
-- ---------------------------------------------------------------------------

-- Site-wide, by the hour: "+N today" and "+N this week" on the admin home. At most four rows an hour.
create table public.journey_starts_hourly (
  hour timestamptz not null,
  -- How the journey started: a pasted (or linked) decklist, or a commander's build.
  kind text not null check (kind in ('paste', 'build')),
  signed_in boolean not null,
  starts integer not null default 0 check (starts >= 0),
  primary key (hour, kind, signed_in)
);

-- Per account, a running count; deleted with the account.
create table public.account_journey_starts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  paste integer not null default 0 check (paste >= 0),
  build integer not null default 0 check (build >= 0),
  last_started_at timestamptz not null default now()
);

alter table public.journey_starts_hourly enable row level security;
alter table public.account_journey_starts enable row level security;
revoke all on public.journey_starts_hourly from anon, authenticated;
revoke all on public.account_journey_starts from anon, authenticated;

-- Counts one journey start. The server calls it with the service role after the visitor's rate limit; nobody else can,
-- so a visitor can't run the numbers up from the browser.
create or replace function public.record_journey_start(p_kind text, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('paste', 'build') then
    raise exception 'Unknown journey kind.' using errcode = '22023';
  end if;

  insert into public.journey_starts_hourly as h (hour, kind, signed_in, starts)
  values (date_trunc('hour', now()), p_kind, p_user_id is not null, 1)
  on conflict (hour, kind, signed_in) do update set starts = h.starts + 1;

  if p_user_id is not null then
    insert into public.account_journey_starts as a (user_id, paste, build, last_started_at)
    values (p_user_id, (p_kind = 'paste')::integer, (p_kind = 'build')::integer, now())
    on conflict (user_id) do update
      set paste = a.paste + (p_kind = 'paste')::integer,
          build = a.build + (p_kind = 'build')::integer,
          last_started_at = now();
  end if;
end;
$$;

revoke execute on function public.record_journey_start(text, uuid) from public, anon, authenticated;
grant execute on function public.record_journey_start(text, uuid) to service_role;

-- The admin home's Journeys number. The rest of admin_site_stats is as 20261126000400_admin_home.sql left it.
create or replace function public.admin_site_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- "Today" on the home page: the last 24 hours rather than the calendar day, so the count reads the same in every
  -- time zone an admin opens it from.
  c_day constant interval := interval '24 hours';
  -- "This week": the last seven days, for the same reason.
  c_week constant interval := interval '7 days';
  v_users jsonb;
  v_decks jsonb;
  v_collections bigint;
  v_imports bigint;
  v_open jsonb;
  v_journeys jsonb;
begin
  perform public.require_platform_admin();

  -- auth.users is one row per account: small, and the same accounts the Users list shows (deleted ones left out).
  select jsonb_build_object(
           'total', count(*),
           'last24h', count(*) filter (where u.created_at > now() - c_day),
           'last7d', count(*) filter (where u.created_at > now() - c_week)
         )
    into v_users
    from auth.users u
   where u.deleted_at is null;

  -- The total is one count; public uses the decks_public partial index; the windows use decks_created_at.
  select jsonb_build_object(
           'total', (select count(*) from public.decks),
           'public', (select count(*) from public.decks d where d.is_public),
           'last24h', (select count(*) from public.decks d where d.created_at > now() - c_day),
           'last7d', (select count(*) from public.decks d where d.created_at > now() - c_week)
         )
    into v_decks;

  -- Accounts with at least one entry: one probe of collection_items_entry (user_id leads it) per account, never a
  -- walk over the entries themselves.
  select count(*)
    into v_collections
    from auth.users u
   where u.deleted_at is null
     and exists (select 1 from public.collection_items c where c.user_id = u.id);

  -- One row per import a player started; small, and old open ones are pruned by start_collection_import.
  select count(*)
    into v_imports
    from public.collection_imports i
   where i.created_at > now() - c_week;

  -- Journeys started: hourly buckets, at most four rows an hour, so this stays a walk over a small table.
  select jsonb_build_object(
           'total', coalesce(sum(j.starts), 0),
           'last24h', coalesce(sum(j.starts) filter (where j.hour > now() - c_day), 0),
           'last7d', coalesce(sum(j.starts) filter (where j.hour > now() - c_week), 0),
           'paste', coalesce(sum(j.starts) filter (where j.kind = 'paste'), 0),
           'build', coalesce(sum(j.starts) filter (where j.kind = 'build'), 0),
           'signedIn', coalesce(sum(j.starts) filter (where j.signed_in), 0)
         )
    into v_journeys
    from public.journey_starts_hourly j;

  -- The same numbers as the header's badges.
  v_open := coalesce(public.admin_open_counts(), '{}'::jsonb);

  return jsonb_build_object(
    'users', v_users,
    'decks', v_decks,
    'collections', v_collections,
    'importsLast7d', v_imports,
    'journeys', v_journeys,
    'openReports', coalesce((v_open->>'reports')::bigint, 0),
    'openErrors', coalesce((v_open->>'errors')::bigint, 0)
  );
end;
$$;

revoke execute on function public.admin_site_stats() from public, anon;
grant execute on function public.admin_site_stats() to authenticated, service_role;

-- Each account's journeys on the Users list and the user page, and a sort by them. The function's columns change,
-- so it is dropped and made again; the rest is as 20260918000100_platform_admins.sql made it.
drop function public.admin_list_users(uuid, text, boolean, text, boolean, integer, integer);

create function public.admin_list_users(
  p_user_id uuid default null,
  p_search text default null,
  p_admins_only boolean default false,
  p_sort text default 'created_at',
  p_ascending boolean default false,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id uuid,
  email text,
  display_name text,
  is_admin boolean,
  admin_note text,
  admin_since timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deck_count integer,
  collection_count integer,
  journey_count integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_platform_admin();

  return query
  with base as (
    select
      u.id,
      u.email::text as email,
      p.display_name,
      (a.user_id is not null) as is_admin,
      a.note as admin_note,
      a.created_at as admin_since,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      (select count(*)::integer from public.decks d where d.user_id = u.id) as deck_count,
      (select count(*)::integer from public.collection_items c where c.user_id = u.id) as collection_count,
      coalesce(j.paste + j.build, 0) as journey_count
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.platform_admins a on a.user_id = u.id
    left join public.account_journey_starts j on j.user_id = u.id
    where u.deleted_at is null
      and (p_user_id is null or u.id = p_user_id)
      and (not coalesce(p_admins_only, false) or a.user_id is not null)
      and (
        v_search is null
        or u.email::text ilike '%' || v_search || '%'
        or coalesce(p.display_name, '') ilike '%' || v_search || '%'
        or u.id::text = v_search
      )
  ),
  keyed as (
    select
      base.*,
      count(*) over () as total_count,
      case p_sort when 'email' then lower(base.email) when 'display_name' then lower(coalesce(base.display_name, '')) end as sort_text,
      case p_sort when 'last_sign_in_at' then base.last_sign_in_at when 'admin_since' then base.admin_since when 'created_at' then base.created_at end as sort_time,
      case p_sort when 'deck_count' then base.deck_count when 'collection_count' then base.collection_count when 'journey_count' then base.journey_count end as sort_num
    from base
  )
  select
    keyed.id, keyed.email, keyed.display_name, keyed.is_admin, keyed.admin_note, keyed.admin_since,
    keyed.created_at, keyed.last_sign_in_at, keyed.email_confirmed_at, keyed.banned_until,
    keyed.deck_count, keyed.collection_count, keyed.journey_count, keyed.total_count
  from keyed
  order by
    case when p_ascending then keyed.sort_text end asc nulls last,
    case when not p_ascending then keyed.sort_text end desc nulls last,
    case when p_ascending then keyed.sort_time end asc nulls last,
    case when not p_ascending then keyed.sort_time end desc nulls last,
    case when p_ascending then keyed.sort_num end asc nulls last,
    case when not p_ascending then keyed.sort_num end desc nulls last,
    keyed.created_at desc,
    keyed.id
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_users(uuid, text, boolean, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_users(uuid, text, boolean, text, boolean, integer, integer) to authenticated, service_role;
