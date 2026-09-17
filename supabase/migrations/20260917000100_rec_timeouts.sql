-- Recommendation queries that ran out of retries, so the slow ones can be found rather than guessed at.
--
-- One row per query shape with a counter, not one row per event: the table is then bounded by the number of
-- distinct shapes (a few tens of thousands at worst) instead of growing with traffic, which matters on a 500 MB
-- tier. `hits` answers "which cards are always slow", `last_seen` answers "is this still happening".

create table public.rec_timeouts (
  id bigint generated always as identity primary key,
  fn text not null check (fn in ('swap', 'add')),
  -- The swap target. Null for cards-to-add, which has no single target card.
  target_card_id integer references public.cards (id),
  commander_ids integer[] not null default '{}',
  identity_mask smallint not null default 0,
  owned_only boolean not null default false,
  hits integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- coalesce so rows with no target still collapse onto one another.
create unique index rec_timeouts_shape
  on public.rec_timeouts (fn, coalesce(target_card_id, 0), commander_ids, identity_mask, owned_only);
create index rec_timeouts_worst on public.rec_timeouts (hits desc, last_seen desc);

alter table public.rec_timeouts enable row level security;
-- No policies: nothing reads this through the API. Look at it with psql, or from the worker as service_role.

revoke all on public.rec_timeouts from anon, authenticated;
grant all on public.rec_timeouts to service_role;

/**
 * Records one exhausted recommendation query. Callable by the API roles because the request that timed out is
 * anonymous; it can only ever bump a counter, so the worst an abuser achieves is inflating a number in a table
 * nobody serves.
 */
create function public.log_rec_timeout(
  p_fn text,
  p_target_card_id integer default null,
  p_commander_ids integer[] default '{}',
  p_identity_mask smallint default 0,
  p_owned_only boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_fn not in ('swap', 'add') then
    return;
  end if;
  insert into public.rec_timeouts (fn, target_card_id, commander_ids, identity_mask, owned_only)
  values (p_fn, p_target_card_id, coalesce(p_commander_ids, '{}'), coalesce(p_identity_mask, 0), coalesce(p_owned_only, false))
  on conflict (fn, coalesce(target_card_id, 0), commander_ids, identity_mask, owned_only)
  do update set hits = public.rec_timeouts.hits + 1, last_seen = now();
exception
  -- Never let bookkeeping turn a slow request into a failed one.
  when others then
    return;
end;
$$;

revoke all on function public.log_rec_timeout(text, integer, integer[], smallint, boolean) from public;
grant execute on function public.log_rec_timeout(text, integer, integer[], smallint, boolean) to anon, authenticated, service_role;

comment on table public.rec_timeouts is
  'Recommendation queries that exhausted their retries. One row per query shape with a hit counter, so the table cannot grow with traffic.';
