-- Error tickets: every failure the site hits, on the server or in a visitor's browser, opens a ticket for the site's
-- admins at /admin/errors, the way a feedback report does (20261116000100_feedback_reports.sql). The first case was
-- report 2 (2026-11-25): a 29,382-row collection import failed at its commit twice, and the only trace left was a
-- console line in Vercel's logs, which age out.
--
-- A ticket is one kind of failure: the same place, the same code and the same message once ids and numbers are taken
-- out (the app hashes that into `fingerprint`). While a ticket is open, each repeat adds an event to it and bumps its
-- count rather than opening another. A failure that comes back after its ticket was resolved opens a new ticket that
-- points at the old one, so a regression shows as one.
--
-- An event keeps what happened in full: the message, where (page, route or action, server or browser), when, the
-- account if one was signed in (its id, never its email: the same promise /privacy makes for feedback), and a
-- `detail` object with the stack, the cause, the request and what the code was doing. Only the newest
-- app_config.error_tickets.eventsPerTicket events of a ticket are kept; its count keeps going.
--
-- Nobody reads these tables directly. The app writes through log_error_event with the service role only (a browser's
-- report goes through a validated, rate-limited Server Action first); admins read and resolve through the admin_*
-- functions below, which check is_platform_admin themselves.

create table public.error_tickets (
  id bigint generated always as identity primary key,
  fingerprint text not null
    constraint error_tickets_fingerprint_shape check (fingerprint ~ '^[0-9a-f]{64}$'),
  level text not null check (level in ('error', 'warning')),
  source text not null check (source in ('server', 'client')),
  area text not null
    constraint error_tickets_area_length check (char_length(area) between 1 and 120),
  code text
    constraint error_tickets_code_length check (char_length(code) between 1 and 60),
  -- The newest event's message and page, so the list reads without the events.
  message text not null
    constraint error_tickets_message_length check (char_length(message) between 1 and 2000),
  page_path text
    constraint error_tickets_page_path_shape check (char_length(page_path) between 1 and 500 and page_path like '/%'),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- The resolved ticket this failure came back after, if any.
  recurrence_of bigint references public.error_tickets (id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

-- One open ticket per fingerprint: log_error_event's upsert relies on it.
create unique index error_tickets_open_fingerprint on public.error_tickets (fingerprint) where resolved_at is null;
create index error_tickets_fingerprint on public.error_tickets (fingerprint, id desc);
create index error_tickets_open_recent on public.error_tickets (last_seen_at desc) where resolved_at is null;
create index error_tickets_recent on public.error_tickets (last_seen_at desc);

create table public.error_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.error_tickets (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  -- The account signed in when it happened. Deleting the account keeps the event and drops the link.
  user_id uuid references auth.users (id) on delete set null,
  page_path text
    constraint error_events_page_path_shape check (char_length(page_path) between 1 and 500 and page_path like '/%'),
  message text not null
    constraint error_events_message_length check (char_length(message) between 1 and 2000),
  detail jsonb not null default '{}'::jsonb
    constraint error_events_detail_shape check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 16000)
);

create index error_events_ticket on public.error_events (ticket_id, id desc);

alter table public.error_tickets enable row level security;
alter table public.error_events enable row level security;
-- No policies: only the functions below touch them.

revoke all on public.error_tickets, public.error_events from anon, authenticated;
grant all on public.error_tickets, public.error_events to service_role;

-- How many events a ticket keeps, and how many tickets may be open before new kinds of failure fold into one overflow
-- ticket (so a flood of distinct messages can't bury the list). A browser's reports have their own rate limit.
insert into public.app_config (key, value, is_public)
values ('error_tickets', '{"eventsPerTicket": 25, "maxOpenTickets": 500}'::jsonb, false)
on conflict (key) do nothing;

-- Twenty browser reports an hour per visitor: a broken page reports itself a few times, a script filling the list
-- gets cut off.
update public.app_config
set value = value || '{"client_error": {"limit": 20, "windowSeconds": 3600}}'::jsonb, updated_at = now()
where key = 'rate_limits' and not value ? 'client_error';

-- Records one failure: adds it to the open ticket for its fingerprint, or opens one. Returns the ticket's id.
-- The service role only: the app has validated and capped every field, and set p_user_id from the verified session.
create function public.log_error_event(
  p_fingerprint text,
  p_level text,
  p_source text,
  p_area text,
  p_message text,
  p_code text default null,
  p_page_path text default null,
  p_user_id uuid default null,
  p_detail jsonb default '{}'::jsonb,
  -- Repeats the app counted without writing each (it writes a warning at most once a minute per server instance).
  p_skipped integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Used when app_config sets none.
  default_events_per_ticket constant integer := 25;
  default_max_open_tickets constant integer := 500;
  -- The ticket that new kinds of failure join once maxOpenTickets are open. Two kinds opening at the same moment can
  -- both slip past the count, which only means a ticket or two over the limit.
  overflow_fingerprint constant text := encode(sha256(convert_to('error-log overflow', 'UTF8')), 'hex');
  config jsonb := coalesce((select value from public.app_config where key = 'error_tickets'), '{}'::jsonb);
  events_kept integer := greatest(coalesce((config ->> 'eventsPerTicket')::integer, default_events_per_ticket), 1);
  max_open integer := greatest(coalesce((config ->> 'maxOpenTickets')::integer, default_max_open_tickets), 1);
  v_fingerprint text := p_fingerprint;
  v_area text := p_area;
  v_code text := nullif(p_code, '');
  v_page text := nullif(p_page_path, '');
  v_ticket bigint;
  v_cutoff bigint;
  v_skipped integer := greatest(coalesce(p_skipped, 0), 0);
begin
  if p_page_path is not null and (char_length(p_page_path) not between 1 and 500 or p_page_path not like '/%') then
    v_page := null;
  end if;
  -- A user id that matches no account (deleted since) is dropped rather than failing the log.
  if p_user_id is not null and not exists (select 1 from auth.users u where u.id = p_user_id) then
    p_user_id := null;
  end if;

  -- Serialises logging per fingerprint, so two repeats can't both open a ticket.
  perform pg_advisory_xact_lock(hashtextextended('error_ticket:' || v_fingerprint, 0));

  select t.id into v_ticket from public.error_tickets t where t.fingerprint = v_fingerprint and t.resolved_at is null;

  if v_ticket is null
     and (select count(*) from public.error_tickets t where t.resolved_at is null) >= max_open
     -- A failure back after its ticket was resolved still gets its own: a regression is what the list is for.
     and not exists (select 1 from public.error_tickets t where t.fingerprint = v_fingerprint) then
    -- Too many kinds of failure open: this one joins the overflow ticket, keeping its own area and code in the event.
    p_detail := coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('overflowFrom', jsonb_build_object('area', v_area, 'code', v_code));
    v_fingerprint := overflow_fingerprint;
    v_area := 'error-log.overflow';
    v_code := null;
    perform pg_advisory_xact_lock(hashtextextended('error_ticket:' || v_fingerprint, 0));
    select t.id into v_ticket from public.error_tickets t where t.fingerprint = v_fingerprint and t.resolved_at is null;
  end if;

  if v_ticket is null then
    insert into public.error_tickets (fingerprint, level, source, area, code, message, page_path, occurrences, recurrence_of)
    values (
      v_fingerprint, p_level, p_source, v_area, v_code, p_message, v_page, 1 + v_skipped,
      (select t.id from public.error_tickets t where t.fingerprint = v_fingerprint order by t.id desc limit 1)
    )
    returning id into v_ticket;
  else
    update public.error_tickets t
    set occurrences = t.occurrences + 1 + v_skipped,
        last_seen_at = now(),
        message = p_message,
        page_path = coalesce(v_page, t.page_path),
        -- A warning that also fails outright reads as an error from then on.
        level = case when p_level = 'error' then 'error' else t.level end
    where t.id = v_ticket;
  end if;

  insert into public.error_events (ticket_id, user_id, page_path, message, detail)
  values (v_ticket, p_user_id, v_page, p_message, coalesce(p_detail, '{}'::jsonb));

  -- Keep the newest events only: delete just the ones past the limit.
  select e.id into v_cutoff
  from public.error_events e
  where e.ticket_id = v_ticket
  order by e.id desc
  offset events_kept
  limit 1;
  if v_cutoff is not null then
    delete from public.error_events e where e.ticket_id = v_ticket and e.id <= v_cutoff;
  end if;

  return v_ticket;
end;
$$;

revoke execute on function public.log_error_event(text, text, text, text, text, text, text, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.log_error_event(text, text, text, text, text, text, text, uuid, jsonb, integer) to service_role;

-- The list behind /admin/errors, most recently seen first. Open only unless p_open_only is false.
create function public.admin_list_error_tickets(
  p_open_only boolean default true,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id bigint,
  level text,
  source text,
  area text,
  code text,
  message text,
  page_path text,
  occurrences integer,
  accounts integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  recurrence_of bigint,
  resolved_at timestamptz,
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
begin
  perform public.require_platform_admin();

  return query
  select t.id, t.level, t.source, t.area, t.code, t.message, t.page_path, t.occurrences,
    -- Distinct signed-in accounts among the events kept: a floor, since older events are dropped.
    (select count(distinct e.user_id)::integer from public.error_events e where e.ticket_id = t.id),
    t.first_seen_at, t.last_seen_at, t.recurrence_of, t.resolved_at,
    count(*) over () as total_count
  from public.error_tickets t
  where not coalesce(p_open_only, true) or t.resolved_at is null
  order by t.last_seen_at desc, t.id desc
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_error_tickets(boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_error_tickets(boolean, integer, integer) to authenticated, service_role;

-- A ticket's kept events, newest first: the full detail of each time it happened.
create function public.admin_error_ticket_events(p_ticket_id bigint)
returns table (
  id bigint,
  occurred_at timestamptz,
  user_id uuid,
  page_path text,
  message text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.error_tickets t where t.id = p_ticket_id) then
    raise exception 'No such ticket.' using errcode = 'no_data_found';
  end if;

  return query
  select e.id, e.occurred_at, e.user_id, e.page_path, e.message, e.detail
  from public.error_events e
  where e.ticket_id = p_ticket_id
  order by e.id desc;
end;
$$;

revoke execute on function public.admin_error_ticket_events(bigint) from public, anon;
grant execute on function public.admin_error_ticket_events(bigint) to authenticated, service_role;

-- Marks a ticket resolved, or open again. Writes only when the state changes, and logs who did it. A ticket can't be
-- reopened while a newer one for the same failure is open: that one carries on from it.
create function public.admin_set_error_ticket_resolved(p_id bigint, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_fingerprint text;
begin
  if p_resolved is null then
    raise exception 'Say whether the ticket is resolved.' using errcode = 'check_violation';
  end if;
  select t.fingerprint into v_fingerprint from public.error_tickets t where t.id = p_id;
  if v_fingerprint is null then
    raise exception 'No such ticket.' using errcode = 'no_data_found';
  end if;
  if not p_resolved and exists (
    select 1 from public.error_tickets t where t.fingerprint = v_fingerprint and t.resolved_at is null and t.id <> p_id
  ) then
    raise exception 'This failure has a newer open ticket. Work from that one.' using errcode = 'check_violation';
  end if;

  update public.error_tickets
  set resolved_at = case when p_resolved then now() end,
      resolved_by = case when p_resolved then v_actor end
  where id = p_id
    and (resolved_at is not null) is distinct from p_resolved;

  if found then
    insert into public.audit_log (actor, action, payload)
    values (
      v_actor,
      case when p_resolved then 'admin.error_ticket_resolve' else 'admin.error_ticket_reopen' end,
      jsonb_build_object('ticket_id', p_id)
    );
  end if;
end;
$$;

revoke execute on function public.admin_set_error_ticket_resolved(bigint, boolean) from public, anon;
grant execute on function public.admin_set_error_ticket_resolved(bigint, boolean) to authenticated, service_role;

-- Open feedback reports and open error tickets, for the header's badges in one read. Null for anyone who isn't a
-- platform admin, so the header asks once instead of checking admin first. Replaces the header's use of
-- admin_open_feedback_report_count, which stays for a deploy still running the older app.
create function public.admin_open_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_platform_admin((select auth.uid()))
      then jsonb_build_object(
        'reports', (select count(*) from public.feedback_reports where resolved_at is null),
        'errors', (select count(*) from public.error_tickets where resolved_at is null)
      )
  end;
$$;

revoke execute on function public.admin_open_counts() from public, anon;
grant execute on function public.admin_open_counts() to authenticated, service_role;
