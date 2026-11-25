-- Error tickets: only the service role can log a failure, repeats join their open ticket, a failure back after its
-- ticket was resolved opens a new one, events are capped, too many open kinds fold into one overflow ticket, and only a
-- platform admin can list, read, count or resolve them. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon, service_role;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- Fingerprints are sha256 hex in the app; any 64 hex characters do here.
create or replace function fp(p_seed text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_seed, 'UTF8')), 'hex'); $$;
grant execute on function fp(text) to service_role, authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'error-admin@test.invalid', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'error-player@test.invalid', '', now(), now());

create temp table parked as select * from public.platform_admins;
delete from public.platform_admins;
insert into public.platform_admins (user_id, note) values ('eeeeeeee-0000-4000-8000-000000000011', 'error ticket test admin');

-- Tickets already in the table stay out of the counts below, and small limits make the caps quick to reach.
create temp table parked_tickets as select * from public.error_tickets;
create temp table parked_events as select * from public.error_events;
delete from public.error_tickets;
create temp table parked_config as select * from public.app_config where key = 'error_tickets';
update public.app_config set value = '{"eventsPerTicket": 3, "maxOpenTickets": 4}'::jsonb where key = 'error_tickets';

select chk('the browser report budget is in app_config',
           (select value -> 'client_error' ->> 'limit' = '20' from public.app_config where key = 'rate_limits'));

-- === nobody but the service role can log ===
set local role anon;
do $$
begin
  perform public.log_error_event(fp('a'), 'error', 'client', 'x', 'm', null, '/', null, '{}');
  perform chk('anon cannot log a failure', false, 'it answered');
exception when insufficient_privilege then
  perform chk('anon cannot log a failure', true, sqlerrm);
end;
$$;
do $$
begin
  perform public.admin_open_counts();
  perform chk('anon cannot count tickets', false, 'it answered');
exception when insufficient_privilege then
  perform chk('anon cannot count tickets', true, sqlerrm);
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000012"}';
do $$
begin
  perform public.log_error_event(fp('a'), 'error', 'client', 'x', 'm', null, '/', null, '{}');
  perform chk('a player cannot log a failure directly', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot log a failure directly', true, sqlerrm);
end;
$$;
select chk('a player gets no counts', public.admin_open_counts() is null);
do $$
begin
  perform public.admin_list_error_tickets();
  perform chk('a player cannot list tickets', false, 'it answered');
exception when insufficient_privilege then
  perform chk('a player cannot list tickets', true, sqlerrm);
end;
$$;
reset role;

-- === the app logs ===
set local role service_role;

select chk('a first failure opens a ticket',
           public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch',
             'Finishing the collection import failed: canceling statement due to statement timeout', 'UPSTREAM_UNAVAILABLE', '/collection',
             'eeeeeeee-0000-4000-8000-000000000012', '{"context": {"rows": 29382}}') > 0);
select chk('a repeat joins the same ticket',
           public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch',
             'Finishing the collection import failed: canceling statement due to statement timeout', 'UPSTREAM_UNAVAILABLE', '/collection',
             null, '{}')
           = (select id from public.error_tickets where fingerprint = fp('commit')));
select public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch', 'third', 'UPSTREAM_UNAVAILABLE', '/collection', null, '{}');
select public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch', 'fourth', 'UPSTREAM_UNAVAILABLE', null, null, '{}');

select chk('the ticket counts every time',
           (select occurrences = 4 from public.error_tickets where fingerprint = fp('commit')));
select chk('the ticket shows the newest message', (select message = 'fourth' from public.error_tickets where fingerprint = fp('commit')));
select chk('a repeat with no page keeps the last page',
           (select page_path = '/collection' from public.error_tickets where fingerprint = fp('commit')));
select chk('only the newest events are kept',
           (select array_agg(message order by id) = array['Finishing the collection import failed: canceling statement due to statement timeout', 'third', 'fourth']
            from public.error_events where ticket_id = (select id from public.error_tickets where fingerprint = fp('commit'))));

select public.log_error_event(fp('limit'), 'warning', 'server', 'collection.rateLimit', 'Too many requests.', 'RATE_LIMITED', '/collection', null, '{}');
select public.log_error_event(fp('limit'), 'error', 'server', 'collection.rateLimit', 'Too many requests.', 'RATE_LIMITED', '/collection', null, '{}');
select chk('a warning that fails outright becomes an error', (select level = 'error' from public.error_tickets where fingerprint = fp('limit')));
select public.log_error_event(fp('limit'), 'warning', 'server', 'collection.rateLimit', 'Too many requests.', 'RATE_LIMITED', '/collection', null, '{}', 5);
select chk('repeats the app skipped still count', (select occurrences = 8 from public.error_tickets where fingerprint = fp('limit')));

select chk('an account that no longer exists is dropped, not refused',
           public.log_error_event(fp('ghost'), 'error', 'client', 'window.error', 'boom', null, '/deck',
             'eeeeeeee-0000-4000-8000-0000000000ff', '{}') > 0);
select chk('a page that is not a site path is dropped',
           public.log_error_event(fp('ghost'), 'error', 'client', 'window.error', 'boom', null, 'https://elsewhere.test/', null, '{}') > 0);
select chk('a ghost account is stored as none',
           (select bool_and(user_id is null) from public.error_events where ticket_id = (select id from public.error_tickets where fingerprint = fp('ghost'))));
do $$
begin
  perform public.log_error_event('not-a-fingerprint', 'error', 'server', 'x', 'm', null, '/', null, '{}');
  perform chk('a malformed fingerprint is refused', false, 'it answered');
exception when check_violation then
  perform chk('a malformed fingerprint is refused', true, sqlerrm);
end;
$$;

-- Four kinds are open now (commit, limit, ghost and this one): the fifth kind folds into the overflow ticket.
select public.log_error_event(fp('fourth kind'), 'error', 'server', 'deck.save', 'm4', null, '/deck', null, '{}');
-- (A statement can't see the rows its own call inserted, so the log and the check are separate statements.)
create temp table fifth as select public.log_error_event(fp('fifth kind'), 'error', 'client', 'window.error', 'm5', 'X1', '/', null, '{}') as id;
select chk('past the open limit a new kind joins the overflow ticket',
           (select area = 'error-log.overflow' from public.error_tickets where id = (select id from fifth)));
select chk('the overflow event keeps where it came from',
           (select detail -> 'overflowFrom' ->> 'area' = 'window.error' from public.error_events where message = 'm5'));
select chk('a known kind still joins its own ticket past the limit',
           (with r as (select public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch', 'fifth', 'UPSTREAM_UNAVAILABLE', '/collection', null, '{}') as id)
            select area = 'collection.saveBatch' from public.error_tickets join r using (id)));
reset role;

-- now() stands still inside this transaction, so give the commit ticket a later sighting by hand.
update public.error_tickets set last_seen_at = now() + interval '1 minute' where fingerprint = fp('commit');

-- === the admin ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000011"}';

select chk('the admin counts open tickets and reports',
           (public.admin_open_counts() ->> 'errors')::int = 5 and (public.admin_open_counts() ? 'reports'));
select chk('the list is most recently seen first',
           (select area = 'collection.saveBatch' from public.admin_list_error_tickets() limit 1));
select chk('the list counts accounts among the kept events',
           (select accounts = 0 from public.admin_list_error_tickets() where area = 'collection.saveBatch'));
select chk('the list carries its total', (select total_count = 5 from public.admin_list_error_tickets(p_limit => 1)));
select chk('a ticket returns its events newest first',
           (select array_agg(message) = array['fifth', 'fourth', 'third']
            from public.admin_error_ticket_events((select id from public.admin_list_error_tickets() where area = 'collection.saveBatch'))));

create temp table commit_ticket as select id from public.admin_list_error_tickets() where area = 'collection.saveBatch';
select public.admin_set_error_ticket_resolved((select id from commit_ticket), true);
select public.admin_set_error_ticket_resolved((select id from commit_ticket), true);
select chk('a resolved ticket leaves the count', (public.admin_open_counts() ->> 'errors')::int = 4);
select chk('the full list still shows it',
           (select resolved_at is not null from public.admin_list_error_tickets(p_open_only => false) where id = (select id from commit_ticket)));
do $$
begin
  perform public.admin_error_ticket_events(-1);
  perform chk('an unknown ticket is not found', false, 'it answered');
exception when no_data_found then
  perform chk('an unknown ticket is not found', true, sqlerrm);
end;
$$;
reset role;

select chk('resolving is logged once',
           (select count(*) = 1 from public.audit_log
            where action = 'admin.error_ticket_resolve' and actor = 'eeeeeeee-0000-4000-8000-000000000011'));

-- The failure comes back: a new ticket, pointing at the resolved one.
set local role service_role;
select public.log_error_event(fp('commit'), 'error', 'server', 'collection.saveBatch', 'again', 'UPSTREAM_UNAVAILABLE', '/collection', null, '{}');
reset role;
select chk('a failure back after resolving opens a new ticket that points at the old one',
           (select recurrence_of = (select id from commit_ticket) and occurrences = 1
            from public.error_tickets where fingerprint = fp('commit') and resolved_at is null));

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000011"}';
do $$
begin
  perform public.admin_set_error_ticket_resolved((select id from commit_ticket), false);
  perform chk('the old ticket cannot reopen beside the new one', false, 'it answered');
exception when check_violation then
  perform chk('the old ticket cannot reopen beside the new one', true, sqlerrm);
end;
$$;
reset role;

update public.app_config c set value = p.value from parked_config p where c.key = p.key;
insert into public.platform_admins select * from parked;
insert into public.error_tickets overriding system value select * from parked_tickets;
insert into public.error_events overriding system value select * from parked_events;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
