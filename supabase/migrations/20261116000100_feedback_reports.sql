-- Feedback reports (T077): a signed-in player tells the site's admins something, from any page. It replaces the
-- prefilled GitHub issue behind the Report link on deck pages.
--
-- A report keeps the message, the path of the page it was sent from (no query string: the deck tool's state never
-- rides along) and when. It belongs to the account that sent it and goes when that account is deleted. Admins read
-- the list at /admin/reports without the sender's email (owner, 2026-11-16).
--
-- Nobody reads feedback_reports directly. Players write through submit_feedback_report; admins read and resolve
-- through the admin_* functions below, which check is_platform_admin themselves.

create table public.feedback_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null
    constraint feedback_reports_message_length check (char_length(message) between 1 and 2000),
  page_path text not null
    constraint feedback_reports_page_path_shape check (char_length(page_path) between 1 and 500 and page_path like '/%'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);

-- The open list and the header's count read only open reports, newest first.
create index feedback_reports_open on public.feedback_reports (created_at desc) where resolved_at is null;
create index feedback_reports_created on public.feedback_reports (created_at desc);

alter table public.feedback_reports enable row level security;
-- No policies: only the functions below touch it.

revoke all on public.feedback_reports from anon, authenticated;
grant all on public.feedback_reports to service_role;

-- Five reports an hour per visitor: plenty for someone with something to say, little for someone filling the list.
update public.app_config
set value = value || '{"feedback": {"limit": 5, "windowSeconds": 3600}}'::jsonb, updated_at = now()
where key = 'rate_limits' and not value ? 'feedback';

-- Stores a report from the signed-in caller. Returns its id. The app validates and rate-limits first; the checks here
-- hold whatever calls it.
create function public.submit_feedback_report(p_message text, p_page_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_message text := btrim(coalesce(p_message, ''));
  v_id bigint;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if char_length(v_message) not between 1 and 2000 then
    raise exception 'A report is 1 to 2,000 characters.' using errcode = 'check_violation';
  end if;
  if p_page_path is null or char_length(p_page_path) not between 1 and 500 or p_page_path not like '/%' then
    raise exception 'That page is not valid.' using errcode = 'check_violation';
  end if;

  insert into public.feedback_reports (user_id, message, page_path)
  values (uid, v_message, p_page_path)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.submit_feedback_report(text, text) from public, anon;
grant execute on function public.submit_feedback_report(text, text) to authenticated, service_role;

-- The list behind /admin/reports, newest first. Open only unless p_open_only is false.
create function public.admin_list_feedback_reports(
  p_open_only boolean default true,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id bigint,
  message text,
  page_path text,
  created_at timestamptz,
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
  select r.id, r.message, r.page_path, r.created_at, r.resolved_at, count(*) over () as total_count
  from public.feedback_reports r
  where not coalesce(p_open_only, true) or r.resolved_at is null
  order by r.created_at desc, r.id desc
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_feedback_reports(boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_feedback_reports(boolean, integer, integer) to authenticated, service_role;

-- Marks a report resolved, or open again. Writes only when the state changes, and logs who did it.
create function public.admin_set_feedback_report_resolved(p_id bigint, p_resolved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
begin
  if p_resolved is null then
    raise exception 'Say whether the report is resolved.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.feedback_reports where id = p_id) then
    raise exception 'No such report.' using errcode = 'no_data_found';
  end if;

  update public.feedback_reports
  set resolved_at = case when p_resolved then now() end,
      resolved_by = case when p_resolved then v_actor end
  where id = p_id
    and (resolved_at is not null) is distinct from p_resolved;

  if found then
    insert into public.audit_log (actor, action, payload)
    values (
      v_actor,
      case when p_resolved then 'admin.report_resolve' else 'admin.report_reopen' end,
      jsonb_build_object('report_id', p_id)
    );
  end if;
end;
$$;

revoke execute on function public.admin_set_feedback_report_resolved(bigint, boolean) from public, anon;
grant execute on function public.admin_set_feedback_report_resolved(bigint, boolean) to authenticated, service_role;

-- How many reports are open, for the header's badge. Null for anyone who isn't a platform admin, so the header asks
-- once instead of checking admin first.
create function public.admin_open_feedback_report_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_platform_admin((select auth.uid()))
      then (select count(*)::int from public.feedback_reports where resolved_at is null)
  end;
$$;

revoke execute on function public.admin_open_feedback_report_count() from public, anon;
grant execute on function public.admin_open_feedback_report_count() to authenticated, service_role;
