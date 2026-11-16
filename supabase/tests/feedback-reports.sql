-- Feedback reports: a signed-in player can send one, nobody reads the table directly, and only a platform admin can
-- list, count or resolve them. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-admin@test.invalid', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'report-player@test.invalid', '', now(), now());

create temp table parked as select * from public.platform_admins;
delete from public.platform_admins;
insert into public.platform_admins (user_id, note) values ('eeeeeeee-0000-4000-8000-000000000001', 'report test admin');

-- Reports already in the table stay out of the counts below.
create temp table parked_reports as select * from public.feedback_reports;
delete from public.feedback_reports;

select chk('the feedback budget is in app_config',
           (select value -> 'feedback' ->> 'limit' = '5' from public.app_config where key = 'rate_limits'));

-- === signed out ===
set local role anon;
do $$
begin
  perform public.submit_feedback_report('Hello', '/');
  perform chk('anon cannot send a report', false, 'it answered');
exception when others then
  perform chk('anon cannot send a report', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_open_feedback_report_count();
  perform chk('anon cannot count reports', false, 'it answered');
exception when others then
  perform chk('anon cannot count reports', true, sqlerrm);
end;
$$;
reset role;

-- === a signed-in player ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000002"}';

select chk('a player can send a report',
           public.submit_feedback_report('  The deck page shows the wrong commander.  ', '/decks/atraxa/abcd1234') > 0);
select chk('a player can send a second report', public.submit_feedback_report('Second one', '/') > 0);

do $$
begin
  perform public.submit_feedback_report('   ', '/');
  perform chk('a blank report is refused', false, 'it answered');
exception when check_violation then
  perform chk('a blank report is refused', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.submit_feedback_report(repeat('x', 2001), '/');
  perform chk('a report over 2,000 characters is refused', false, 'it answered');
exception when check_violation then
  perform chk('a report over 2,000 characters is refused', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.submit_feedback_report('Hello', 'https://example.com/');
  perform chk('a page that is not a path is refused', false, 'it answered');
exception when check_violation then
  perform chk('a page that is not a path is refused', true, sqlerrm);
end;
$$;
do $$
begin
  perform count(*) from public.feedback_reports;
  perform chk('a player cannot read the table', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot read the table', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_list_feedback_reports();
  perform chk('a player cannot list reports', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot list reports', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_set_feedback_report_resolved(1, true);
  perform chk('a player cannot resolve a report', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot resolve a report', true, sqlerrm);
end;
$$;
select chk('a player gets no count', public.admin_open_feedback_report_count() is null);
reset role;

select chk('the message is stored trimmed',
           exists (select 1 from public.feedback_reports
                   where message = 'The deck page shows the wrong commander.'
                     and page_path = '/decks/atraxa/abcd1234'
                     and user_id = 'eeeeeeee-0000-4000-8000-000000000002'));

-- === the admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';

select chk('the admin counts two open reports', public.admin_open_feedback_report_count() = 2);
select chk('the open list is newest first',
           (select array_agg(message order by ord) from (
              select message, row_number() over () as ord from public.admin_list_feedback_reports()) l)
           = array['Second one', 'The deck page shows the wrong commander.']);
select chk('the list carries its total', (select total_count = 2 from public.admin_list_feedback_reports(p_limit => 1)));

select public.admin_set_feedback_report_resolved(
  (select id from public.admin_list_feedback_reports() where message = 'Second one'), true);
select chk('a resolved report leaves the count', public.admin_open_feedback_report_count() = 1);
select chk('a resolved report leaves the open list', (select count(*) = 1 from public.admin_list_feedback_reports()));
select chk('the full list still shows it',
           (select resolved_at is not null from public.admin_list_feedback_reports(p_open_only => false)
            where message = 'Second one'));

-- Resolving twice changes nothing and logs nothing more.
select public.admin_set_feedback_report_resolved(
  (select id from public.admin_list_feedback_reports(p_open_only => false) where message = 'Second one'), true);
reset role;
select chk('resolving is logged once',
           (select count(*) = 1 from public.audit_log
            where action = 'admin.report_resolve' and actor = 'eeeeeeee-0000-4000-8000-000000000001'));
select chk('the resolver is stored',
           (select resolved_by = 'eeeeeeee-0000-4000-8000-000000000001' from public.feedback_reports where message = 'Second one'));

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';
select public.admin_set_feedback_report_resolved(
  (select id from public.admin_list_feedback_reports(p_open_only => false) where message = 'Second one'), false);
select chk('a reopened report counts again', public.admin_open_feedback_report_count() = 2);
do $$
begin
  perform public.admin_set_feedback_report_resolved(-1, true);
  perform chk('an unknown report is not found', false, 'it answered');
exception when no_data_found then
  perform chk('an unknown report is not found', true, sqlerrm);
end;
$$;
reset role;

select chk('a reopened report has no resolver',
           (select resolved_at is null and resolved_by is null from public.feedback_reports where message = 'Second one'));

insert into public.platform_admins select * from parked;
insert into public.feedback_reports overriding system value select * from parked_reports;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
