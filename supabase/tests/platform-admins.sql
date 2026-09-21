-- Exercises the platform admin guard and the user-management functions, above all that a signed-in non-admin
-- cannot read the user list or change anybody. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@test.invalid', '', now(), now()),
  ('aaaaaaaa-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@test.invalid', '', now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'player@test.invalid', '', now(), now());

-- The other admins this database already has would change the "last admin" arithmetic below, so the test works
-- against its own set: park the existing rows and put them back before rolling back anyway.
create temp table parked as select * from public.platform_admins;
delete from public.platform_admins;

insert into public.platform_admins (user_id, note) values ('aaaaaaaa-0000-4000-8000-000000000001', 'test admin');

-- A tag and a sync run of the test's own, so the tag and sync checks don't depend on a loaded catalog.
insert into public.tags (id, type, slug, label, content_hash)
values ('cccccccc-0000-4000-8000-000000000001', 'oracle', 'zz-admin-test-tag', 'ZZ admin test tag', decode('00', 'hex'));
insert into public.sync_runs (job, status, worker_id, error, finished_at)
values ('precon_import', 'failed', 'admin-test', 'admin test failure', now());

-- === signed out ===
set local role anon;
do $$ begin
  perform public.admin_list_users();
  insert into t values ('anon cannot list users', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot list users', sqlstate in ('42501', '42883'), sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_list_tags();
  insert into t values ('anon cannot list tags', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot list tags', sqlstate in ('42501', '42883'), sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_list_sync_runs();
  insert into t values ('anon cannot list sync runs', false, 'no error raised');
exception when others then
  insert into t values ('anon cannot list sync runs', sqlstate in ('42501', '42883'), sqlstate || ' ' || sqlerrm);
end $$;

-- === a signed-in player who is not an admin ===
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000001"}';

select chk('non-admin sees is_platform_admin false', not public.is_platform_admin());
select chk('non-admin cannot see the admin list through RLS', (select count(*) = 0 from public.platform_admins));

do $$ begin
  perform public.admin_list_users();
  insert into t values ('non-admin cannot list users', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot list users', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_platform_admin('bbbbbbbb-0000-4000-8000-000000000001', true);
  insert into t values ('non-admin cannot make themselves an admin', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot make themselves an admin', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_delete_user('aaaaaaaa-0000-4000-8000-000000000001');
  insert into t values ('non-admin cannot delete a user', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot delete a user', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_user_banned('aaaaaaaa-0000-4000-8000-000000000001', true);
  insert into t values ('non-admin cannot ban a user', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot ban a user', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_display_name('bbbbbbbb-0000-4000-8000-000000000001', 'Renamed By Themselves');
  insert into t values ('non-admin cannot use the admin rename', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot use the admin rename', sqlstate = '42501', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_list_tags();
  insert into t values ('non-admin cannot list tags', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot list tags', sqlstate in ('42501'), sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_tag_disabled('cccccccc-0000-4000-8000-000000000001', true, 'not mine to switch');
  insert into t values ('non-admin cannot disable a tag', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot disable a tag', sqlstate in ('42501'), sqlstate || ' ' || sqlerrm);
end $$;

select chk('non-admin cannot write tags directly either', not has_table_privilege('authenticated', 'public.tags', 'update'));

do $$ begin
  perform public.admin_list_sync_runs();
  insert into t values ('non-admin cannot list sync runs', false, 'no error raised');
exception when others then
  insert into t values ('non-admin cannot list sync runs', sqlstate in ('42501'), sqlstate || ' ' || sqlerrm);
end $$;

-- === the admin ===
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001"}';

select chk('admin sees is_platform_admin true', public.is_platform_admin());
select chk('admin reads the admin list through RLS', (select count(*) = 1 from public.platform_admins));

select chk('list returns the three test users',
  (select count(*) >= 3 from public.admin_list_users(p_limit => 200)));
select chk('list carries the row total',
  (select total_count >= 3 from public.admin_list_users(p_limit => 1) limit 1));
select chk('search by email narrows to one',
  (select count(*) = 1 from public.admin_list_users(p_search => 'player@test.invalid')));
select chk('search by id works',
  (select count(*) = 1 from public.admin_list_users(p_search => 'bbbbbbbb-0000-4000-8000-000000000001')));
select chk('admins_only filter',
  (select count(*) = 1 and bool_and(is_admin) from public.admin_list_users(p_admins_only => true, p_limit => 200)));
select chk('single user lookup',
  (select email = 'player@test.invalid' from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-000000000001')));
select chk('list marks the admin',
  (select is_admin from public.admin_list_users(p_user_id => 'aaaaaaaa-0000-4000-8000-000000000001')));
select chk('sorting by email ascending is stable',
  (select email = 'admin-a@test.invalid' from public.admin_list_users(p_sort => 'email', p_ascending => true, p_limit => 1)));

select public.admin_set_display_name('bbbbbbbb-0000-4000-8000-000000000001', '  Renamed  ');
select chk('admin renames a player',
  (select display_name = 'Renamed' from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-000000000001')));
select public.admin_set_display_name('bbbbbbbb-0000-4000-8000-000000000001', '   ');
select chk('a blank name clears it',
  (select display_name is null from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-000000000001')));

do $$ begin
  perform public.admin_set_display_name('bbbbbbbb-0000-4000-8000-000000000001', repeat('x', 61));
  insert into t values ('rename refuses an over-long name', false, 'no error raised');
exception when others then
  insert into t values ('rename refuses an over-long name', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

select public.admin_set_platform_admin('aaaaaaaa-0000-4000-8000-000000000002', true, 'second admin');
select chk('admin grants admin to someone else',
  (select count(*) = 1 from public.platform_admins where user_id = 'aaaaaaaa-0000-4000-8000-000000000002'));
select chk('the note is stored',
  (select note = 'second admin' from public.platform_admins where user_id = 'aaaaaaaa-0000-4000-8000-000000000002'));
do $$ begin
  perform public.admin_set_platform_admin('aaaaaaaa-0000-4000-8000-000000000001', false);
  insert into t values ('an admin cannot revoke themselves', false, 'no error raised');
exception when others then
  insert into t values ('an admin cannot revoke themselves', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_delete_user('aaaaaaaa-0000-4000-8000-000000000002');
  insert into t values ('an admin cannot be deleted before being revoked', false, 'no error raised');
exception when others then
  insert into t values ('an admin cannot be deleted before being revoked', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_user_banned('aaaaaaaa-0000-4000-8000-000000000002', true);
  insert into t values ('an admin cannot be banned before being revoked', false, 'no error raised');
exception when others then
  insert into t values ('an admin cannot be banned before being revoked', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

select public.admin_set_platform_admin('aaaaaaaa-0000-4000-8000-000000000002', false);
select chk('admin revokes the other admin',
  (select count(*) = 0 from public.platform_admins where user_id = 'aaaaaaaa-0000-4000-8000-000000000002'));

-- Revoking someone who never had it is a no-op, not an error, even when that leaves the admin count at one.
do $$ begin
  perform public.admin_set_platform_admin('bbbbbbbb-0000-4000-8000-000000000001', false);
  insert into t values ('revoking a non-admin is a no-op', true, '');
exception when others then
  insert into t values ('revoking a non-admin is a no-op', false, sqlstate || ' ' || sqlerrm);
end $$;
select chk('the sole remaining admin is still an admin', public.is_platform_admin());

select public.admin_set_user_banned('bbbbbbbb-0000-4000-8000-000000000001', true);
select chk('banning sets banned_until in the future',
  (select banned_until > now() from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-000000000001')));
select public.admin_set_user_banned('bbbbbbbb-0000-4000-8000-000000000001', false);
select chk('unbanning clears it',
  (select banned_until is null from public.admin_list_users(p_user_id => 'bbbbbbbb-0000-4000-8000-000000000001')));

do $$ begin
  perform public.admin_set_user_banned('aaaaaaaa-0000-4000-8000-000000000001', true);
  insert into t values ('an admin cannot ban themselves', false, 'no error raised');
exception when others then
  insert into t values ('an admin cannot ban themselves', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_delete_user('aaaaaaaa-0000-4000-8000-000000000001');
  insert into t values ('an admin cannot delete themselves', false, 'no error raised');
exception when others then
  insert into t values ('an admin cannot delete themselves', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_platform_admin('00000000-0000-4000-8000-00000000dead', true);
  insert into t values ('granting to an unknown user is refused', false, 'no error raised');
exception when others then
  insert into t values ('granting to an unknown user is refused', sqlstate = 'P0002', sqlstate || ' ' || sqlerrm);
end $$;

select public.admin_delete_user('aaaaaaaa-0000-4000-8000-000000000002');
select chk('admin deletes a plain user',
  (select count(*) = 0 from public.admin_list_users(p_user_id => 'aaaaaaaa-0000-4000-8000-000000000002')));

-- Tags: the kill switch.
select chk('admin finds a tag by search',
  (select count(*) = 1 and bool_and(not disabled) from public.admin_list_tags(p_search => 'zz admin test')));

select public.admin_set_tag_disabled('cccccccc-0000-4000-8000-000000000001', true, '  trivia, not a job  ');
select chk('disabling records the trimmed reason, who and when',
  (select disabled and disabled_reason = 'trivia, not a job' and disabled_by_email = 'admin-a@test.invalid'
     and disabled_at is not null
   from public.admin_list_tags(p_tag_id => 'cccccccc-0000-4000-8000-000000000001')));
select chk('a disabled tag shows under the disabled filter',
  (select count(*) = 1 from public.admin_list_tags(p_disabled_only => true, p_search => 'zz admin test')));

select public.admin_set_tag_disabled('cccccccc-0000-4000-8000-000000000001', true, 'trivia, not a job');
select chk('saving the same switch again leaves it disabled',
  (select count(*) = 1 from public.admin_list_tags(p_tag_id => 'cccccccc-0000-4000-8000-000000000001', p_disabled_only => true)));

do $$ begin
  perform public.admin_set_tag_disabled('cccccccc-0000-4000-8000-000000000001', true, repeat('x', 201));
  insert into t values ('a reason over 200 characters is refused', false, 'no error raised');
exception when others then
  insert into t values ('a reason over 200 characters is refused', sqlstate in ('23514'), sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform public.admin_set_tag_disabled('00000000-0000-4000-8000-00000000dead', true);
  insert into t values ('disabling an unknown tag is refused', false, 'no error raised');
exception when others then
  insert into t values ('disabling an unknown tag is refused', sqlstate in ('P0002'), sqlstate || ' ' || sqlerrm);
end $$;

select public.admin_set_tag_disabled('cccccccc-0000-4000-8000-000000000001', false, 'ignored when enabling');
select chk('enabling clears the reason, who and when',
  (select not disabled and disabled_reason is null and disabled_by_email is null and disabled_at is null
   from public.admin_list_tags(p_tag_id => 'cccccccc-0000-4000-8000-000000000001')));

-- Sync runs.
select chk('admin finds a failed run by job and status, with its error',
  (select count(*) = 1 and bool_and(error = 'admin test failure')
   from public.admin_list_sync_runs(p_job => 'precon_import', p_status => 'failed')
   where worker_id = 'admin-test'));
select chk('an unknown job filters to nothing rather than failing',
  (select count(*) = 0 from public.admin_list_sync_runs(p_job => 'no_such_job')));

-- The audit log is service-role only, so its rows are checked once the test is out of the authenticated role.
reset role;
select chk('the tag switch is audited once per real change',
  (select count(*) filter (where action = 'admin.tag_disable') = 1
      and count(*) filter (where action = 'admin.tag_enable') = 1
   from public.audit_log where payload->>'tag_id' = 'cccccccc-0000-4000-8000-000000000001'));
select chk('granting is written to the audit log',
  (select count(*) = 1 from public.audit_log
   where action = 'admin.grant' and payload->>'user_id' = 'aaaaaaaa-0000-4000-8000-000000000002'));

select chk('the deletion is written to the audit log with the email',
  (select payload->>'email' = 'admin-b@test.invalid' from public.audit_log
   where action = 'admin.delete_user' and payload->>'user_id' = 'aaaaaaaa-0000-4000-8000-000000000002'));

insert into public.platform_admins select * from parked;

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
