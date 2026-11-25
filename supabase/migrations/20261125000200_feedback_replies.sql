-- Replies to feedback reports: an admin answers a report from /admin/reports and the player gets it by email, at the
-- address on their account (owner asked 2026-11-25).
--
-- The admin never sees that address, which keeps what /privacy promises about feedback. The app looks it up with the
-- service role (feedback_report_recipient, nobody else may run it) and hands it straight to the mail provider; the
-- admin's browser only ever gets the reply's outcome.
--
-- Each reply is recorded, sent or not: admin_start_feedback_reply before the email goes out ('sending'), and
-- admin_finish_feedback_reply with the outcome. A reply that stays 'sending' means the app stopped between the two.

create table public.feedback_report_replies (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.feedback_reports (id) on delete cascade,
  message text not null
    constraint feedback_report_replies_message_length check (char_length(message) between 1 and 5000),
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  -- The provider's id for the email, to find it in the provider's own logs.
  provider_message_id text
    constraint feedback_report_replies_provider_id_length check (char_length(provider_message_id) between 1 and 200),
  -- Why sending failed, as the provider said it.
  failure text
    constraint feedback_report_replies_failure_length check (char_length(failure) between 1 and 1000),
  finished_at timestamptz
);

create index feedback_report_replies_report on public.feedback_report_replies (report_id, id);

alter table public.feedback_report_replies enable row level security;
-- No policies: only the functions below touch it.

revoke all on public.feedback_report_replies from anon, authenticated;
grant all on public.feedback_report_replies to service_role;

-- The address a reply to this report goes to: the sender's account email. Null when the report or the address is gone.
-- Service role only, so no admin session can read an address through it.
create function public.feedback_report_recipient(p_report_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.feedback_reports r
  join auth.users u on u.id = r.user_id
  where r.id = p_report_id;
$$;

revoke execute on function public.feedback_report_recipient(bigint) from public, anon, authenticated;
grant execute on function public.feedback_report_recipient(bigint) to service_role;

-- Records a reply about to be sent and returns its id, with what the email quotes: the report's message, page and date.
create function public.admin_start_feedback_reply(p_report_id bigint, p_message text)
returns table (reply_id bigint, report_message text, report_page_path text, report_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_message text := btrim(coalesce(p_message, ''));
  v_report public.feedback_reports;
  v_id bigint;
begin
  if char_length(v_message) not between 1 and 5000 then
    raise exception 'A reply is 1 to 5,000 characters.' using errcode = 'check_violation';
  end if;
  select * into v_report from public.feedback_reports where id = p_report_id;
  if v_report.id is null then
    raise exception 'No such report.' using errcode = 'no_data_found';
  end if;

  insert into public.feedback_report_replies (report_id, message, sent_by)
  values (p_report_id, v_message, v_actor)
  returning id into v_id;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.report_reply', jsonb_build_object('report_id', p_report_id, 'reply_id', v_id));

  return query select v_id, v_report.message, v_report.page_path, v_report.created_at;
end;
$$;

revoke execute on function public.admin_start_feedback_reply(bigint, text) from public, anon;
grant execute on function public.admin_start_feedback_reply(bigint, text) to authenticated, service_role;

-- Records how sending went. Only a reply still 'sending' changes, so an outcome can't be written twice.
create function public.admin_finish_feedback_reply(
  p_reply_id bigint,
  p_sent boolean,
  p_provider_message_id text default null,
  p_failure text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  update public.feedback_report_replies
  set status = case when p_sent then 'sent' else 'failed' end,
      provider_message_id = case when p_sent then left(nullif(p_provider_message_id, ''), 200) end,
      failure = case when p_sent then null else left(coalesce(nullif(p_failure, ''), 'Unknown failure'), 1000) end,
      finished_at = now()
  where id = p_reply_id and status = 'sending';
  if not found then
    raise exception 'No reply waiting to be sent.' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function public.admin_finish_feedback_reply(bigint, boolean, text, text) from public, anon;
grant execute on function public.admin_finish_feedback_reply(bigint, boolean, text, text) to authenticated, service_role;

-- The replies to a page of reports, oldest first within each, for /admin/reports.
create function public.admin_feedback_report_replies(p_report_ids bigint[])
returns table (
  id bigint,
  report_id bigint,
  message text,
  status text,
  failure text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- A page of reports is at most 200 (admin_list_feedback_reports' clamp).
  max_reports constant integer := 200;
begin
  perform public.require_platform_admin();
  if cardinality(p_report_ids) > max_reports then
    raise exception 'Ask for at most % reports at once.', max_reports using errcode = 'check_violation';
  end if;

  return query
  select r.id, r.report_id, r.message, r.status, r.failure, r.created_at
  from public.feedback_report_replies r
  where r.report_id = any (p_report_ids)
  order by r.report_id, r.id;
end;
$$;

revoke execute on function public.admin_feedback_report_replies(bigint[]) from public, anon;
grant execute on function public.admin_feedback_report_replies(bigint[]) to authenticated, service_role;
