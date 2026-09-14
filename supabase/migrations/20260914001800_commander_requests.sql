-- Commander deck lookups: when a pasted deck's commander has too few corpus decks, the visitor can ask for them. Lookups
-- run one at a time in a shared queue served by the worker (serve:commander-requests), which writes progress here for
-- the deck tool to show. Two visitors asking for the same commander share one lookup. API roles never touch the table
-- directly; they go through the functions below, which apply rate limits, a queue cap and cooldowns from app_config.

create type public.commander_request_status as enum (
  'queued', 'checking', 'collecting', 'aggregating', 'done', 'not_enough_decks', 'failed'
);

create table public.commander_requests (
  id bigint generated always as identity primary key,
  commander_card_id integer not null references public.cards (id),
  status public.commander_request_status not null default 'queued',
  decks_target smallint not null,
  decks_listed integer, -- 100-card decks Archidekt lists for the commander (1000 = 1,000 or more)
  decks_collected integer not null default 0,
  error text,
  client_key text, -- salted hash of the requester's address: rate limits, and telling joiners from the requester
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now() -- last progress change; the worker's liveness is heartbeat_at
);

create unique index commander_requests_one_active on public.commander_requests (commander_card_id)
  where status in ('queued', 'checking', 'collecting', 'aggregating');
create index commander_requests_queue on public.commander_requests (created_at) where status = 'queued';
create index commander_requests_card_recent on public.commander_requests (commander_card_id, created_at desc);
create index commander_requests_client_recent on public.commander_requests (client_key, created_at desc) where client_key is not null;

-- Last time each long-running worker checked in, so the app can say when no one is serving the queue.
create table public.worker_status (
  name text primary key,
  heartbeat_at timestamptz not null
);

alter table public.commander_requests enable row level security;
alter table public.worker_status enable row level security;
grant all on public.commander_requests, public.worker_status to service_role;

-- secondsPerDeck and aggregateSeconds feed the wait estimate shown to visitors; tune them to the worker's real pace.
insert into public.app_config (key, value, is_public)
values (
  'commander_requests',
  '{"targetDecks": 100, "maxActive": 25, "perClientPerHour": 5, "notEnoughCooldownDays": 7, "failedCooldownMinutes": 30, "doneReuseHours": 24, "secondsPerDeck": 3.4, "aggregateSeconds": 20}'::jsonb,
  false
)
on conflict (key) do update set value = excluded.value, updated_at = now();

create function public.commander_request_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.app_config where key = 'commander_requests'), '{}'::jsonb)
$$;

create function public.commander_collector_online()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.worker_status where name = 'commander-requests' and heartbeat_at > now() - interval '30 seconds'
  )
$$;

-- A lookup as the deck tool sees it. Anyone ahead in the queue, including the running lookup, counts toward its wait.
create function public.commander_request_json(r public.commander_requests, p_client_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ahead as (
    select count(*) as requests, coalesce(sum(greatest(q.decks_target - q.decks_collected, 0)), 0) as decks
    from public.commander_requests q
    where r.status = 'queued'
      and (q.status in ('checking', 'collecting', 'aggregating') or (q.status = 'queued' and q.created_at < r.created_at))
  )
  select jsonb_build_object(
    'id', r.id::text,
    'commanderCardId', r.commander_card_id,
    'status', r.status,
    'decksTarget', r.decks_target,
    'decksListed', r.decks_listed,
    'decksCollected', r.decks_collected,
    'error', r.error,
    'joined', r.client_key is distinct from p_client_key,
    'updatedAt', r.updated_at,
    'queuePosition', ahead.requests,
    'decksAhead', ahead.decks,
    'secondsPerDeck', public.commander_request_config() -> 'secondsPerDeck',
    'aggregateSeconds', public.commander_request_config() -> 'aggregateSeconds',
    'collectorOnline', public.commander_collector_online()
  )
  from ahead
$$;

-- A finished lookup whose result still stands: not enough decks (for days), a failure (briefly), or one that just
-- finished. While it stands, asking again returns it instead of starting over.
create function public.commander_request_recent(p_card_id integer)
returns public.commander_requests
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.commander_requests r, lateral (select public.commander_request_config() as cfg) c
  where r.commander_card_id = p_card_id
    and (
      (r.status = 'not_enough_decks' and r.finished_at > now() - make_interval(days => coalesce((c.cfg ->> 'notEnoughCooldownDays')::int, 7)))
      or (r.status = 'failed' and r.finished_at > now() - make_interval(mins => coalesce((c.cfg ->> 'failedCooldownMinutes')::int, 30)))
      or (r.status = 'done' and r.finished_at > now() - make_interval(hours => coalesce((c.cfg ->> 'doneReuseHours')::int, 24)))
    )
  order by r.created_at desc
  limit 1
$$;

-- The lookup to show for a commander before asking the visitor to wait: the active one, or a recent result that still
-- stands. Never starts a lookup. The backlog sizes the wait a new lookup would have.
create function public.get_commander_request(p_card_id integer, p_client_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.commander_request_config();
  request_row public.commander_requests;
begin
  select * into request_row
  from public.commander_requests r
  where r.commander_card_id = p_card_id and r.status in ('queued', 'checking', 'collecting', 'aggregating');

  if request_row.id is null then
    request_row := public.commander_request_recent(p_card_id);
  end if;

  return jsonb_build_object(
    'request', case when request_row.id is null then null else public.commander_request_json(request_row, p_client_key) end,
    'backlogRequests', (select count(*) from public.commander_requests q where q.status in ('queued', 'checking', 'collecting', 'aggregating')),
    'backlogDecks', (
      select coalesce(sum(greatest(q.decks_target - q.decks_collected, 0)), 0)
      from public.commander_requests q
      where q.status in ('queued', 'checking', 'collecting', 'aggregating')
    ),
    'targetDecks', coalesce((cfg ->> 'targetDecks')::int, 100),
    'secondsPerDeck', cfg -> 'secondsPerDeck',
    'aggregateSeconds', cfg -> 'aggregateSeconds',
    'collectorOnline', public.commander_collector_online()
  );
end;
$$;

-- Starts a lookup, or joins the active one for the same commander. Raises RATE_LIMITED, QUEUE_FULL or NOT_A_COMMANDER.
create function public.request_commander_decks(p_card_id integer, p_client_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.commander_request_config();
  request_row public.commander_requests;
begin
  if not exists (
    select 1 from public.cards c
    where c.id = p_card_id and c.deleted_at is null and c.can_be_commander and c.legal_commander = 'legal'
  ) then
    raise exception 'NOT_A_COMMANDER';
  end if;

  select * into request_row
  from public.commander_requests r
  where r.commander_card_id = p_card_id and r.status in ('queued', 'checking', 'collecting', 'aggregating');
  if request_row.id is not null then
    return public.commander_request_json(request_row, p_client_key);
  end if;

  request_row := public.commander_request_recent(p_card_id);
  if request_row.id is not null then
    return public.commander_request_json(request_row, p_client_key);
  end if;

  if p_client_key is not null and (
    select count(*) from public.commander_requests r
    where r.client_key = p_client_key and r.created_at > now() - interval '1 hour'
  ) >= coalesce((cfg ->> 'perClientPerHour')::int, 5) then
    raise exception 'RATE_LIMITED';
  end if;

  if (
    select count(*) from public.commander_requests r where r.status in ('queued', 'checking', 'collecting', 'aggregating')
  ) >= coalesce((cfg ->> 'maxActive')::int, 25) then
    raise exception 'QUEUE_FULL';
  end if;

  insert into public.commander_requests (commander_card_id, decks_target, client_key)
  values (p_card_id, coalesce((cfg ->> 'targetDecks')::smallint, 100), p_client_key)
  on conflict do nothing
  returning * into request_row;

  -- Someone else started a lookup for this commander a moment ago: join it.
  if request_row.id is null then
    select * into request_row
    from public.commander_requests r
    where r.commander_card_id = p_card_id and r.status in ('queued', 'checking', 'collecting', 'aggregating');
  end if;

  return public.commander_request_json(request_row, p_client_key);
end;
$$;

create function public.get_commander_request_status(p_request_id bigint, p_client_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.commander_request_json(r, p_client_key) from public.commander_requests r where r.id = p_request_id
$$;

revoke execute on function public.commander_request_config() from public;
revoke execute on function public.commander_collector_online() from public;
revoke execute on function public.commander_request_json(public.commander_requests, text) from public;
revoke execute on function public.commander_request_recent(integer) from public;
revoke execute on function public.get_commander_request(integer, text) from public;
revoke execute on function public.request_commander_decks(integer, text) from public;
revoke execute on function public.get_commander_request_status(bigint, text) from public;

grant execute on function public.commander_request_config() to service_role;
grant execute on function public.commander_collector_online() to service_role;
grant execute on function public.commander_request_json(public.commander_requests, text) to service_role;
grant execute on function public.commander_request_recent(integer) to service_role;
grant execute on function public.get_commander_request(integer, text) to anon, authenticated, service_role;
grant execute on function public.request_commander_decks(integer, text) to anon, authenticated, service_role;
grant execute on function public.get_commander_request_status(bigint, text) to anon, authenticated, service_role;
