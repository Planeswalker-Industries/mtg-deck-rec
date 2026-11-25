-- Replies to feedback reports: only a platform admin can record one, only the service role can read the address it
-- goes to, an outcome is written once, and replies list per report. Runs in a transaction and rolls back.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reply-admin@test.invalid', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reply-player@test.invalid', '', now(), now());

create temp table parked as select * from public.platform_admins;
delete from public.platform_admins;
insert into public.platform_admins (user_id, note) values ('eeeeeeee-0000-4000-8000-000000000021', 'reply test admin');

insert into public.feedback_reports (user_id, message, page_path)
values ('eeeeeeee-0000-4000-8000-000000000022', 'My collection won''t import.', '/collection');
create temp table report as select id from public.feedback_reports where user_id = 'eeeeeeee-0000-4000-8000-000000000022';
grant select on report to authenticated, anon, service_role;

-- === the address is the service role's alone ===
set local role service_role;
select chk('the service role reads the address a reply goes to',
           public.feedback_report_recipient((select id from report)) = 'reply-player@test.invalid');
select chk('an unknown report has no address', public.feedback_report_recipient(-1) is null);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000021"}';
do $$
begin
  perform public.feedback_report_recipient((select id from report));
  perform chk('not even an admin reads the address', false, 'it answered');
exception when insufficient_privilege then
  perform chk('not even an admin reads the address', true, sqlerrm);
end;
$$;
reset role;

-- === a player can't reply ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000022"}';
do $$
begin
  perform public.admin_start_feedback_reply((select id from report), 'hi');
  perform chk('a player cannot reply', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot reply', true, sqlerrm);
end;
$$;
reset role;

set local role anon;
do $$
begin
  perform public.admin_feedback_report_replies(array[1]::bigint[]);
  perform chk('anon cannot list replies', false, 'it answered');
exception when insufficient_privilege then
  perform chk('anon cannot list replies', true, sqlerrm);
end;
$$;
reset role;

-- === the admin replies ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000021"}';

create temp table started as
  select * from public.admin_start_feedback_reply((select id from report), '  Fixed now, try again.  ');
select chk('starting a reply hands back what the email quotes',
           (select report_message = 'My collection won''t import.' and report_page_path = '/collection' and reply_id > 0 from started));
do $$
begin
  perform public.admin_start_feedback_reply((select id from report), '   ');
  perform chk('a blank reply is refused', false, 'it answered');
exception when check_violation then
  perform chk('a blank reply is refused', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_start_feedback_reply(-1, 'hello');
  perform chk('a reply to no report is refused', false, 'it answered');
exception when no_data_found then
  perform chk('a reply to no report is refused', true, sqlerrm);
end;
$$;

select chk('a started reply lists as sending',
           (select status = 'sending' and message = 'Fixed now, try again.'
            from public.admin_feedback_report_replies(array[(select id from report)])));
select public.admin_finish_feedback_reply((select reply_id from started), true, 'resend-123');
select chk('a sent reply lists as sent',
           (select status = 'sent' and failure is null from public.admin_feedback_report_replies(array[(select id from report)])));
do $$
begin
  perform public.admin_finish_feedback_reply((select reply_id from started), false, null, 'late');
  perform chk('an outcome is written once', false, 'it answered');
exception when no_data_found then
  perform chk('an outcome is written once', true, sqlerrm);
end;
$$;

create temp table second as select * from public.admin_start_feedback_reply((select id from report), 'Second try');
select public.admin_finish_feedback_reply((select reply_id from second), false, null, 'The sending domain is not verified');
select chk('a failed reply keeps why',
           (select array_agg(status order by id) = array['sent', 'failed']
              and bool_or(failure = 'The sending domain is not verified')
            from public.admin_feedback_report_replies(array[(select id from report)])));
reset role;

select chk('the sender and provider id are stored',
           (select sent_by = 'eeeeeeee-0000-4000-8000-000000000021' and provider_message_id = 'resend-123'
            from public.feedback_report_replies where id = (select reply_id from started)));
select chk('replying is logged', (select count(*) = 2 from public.audit_log where action = 'admin.report_reply'));

insert into public.platform_admins select * from parked;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
