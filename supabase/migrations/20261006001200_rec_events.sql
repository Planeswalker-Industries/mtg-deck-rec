-- Live accept rate (T065; docs/roadmap/scoring-design.md, "Evaluation"): what suggestions the deck tool showed, and
-- which the player took or passed on, recorded per visitor the way swap votes are. /privacy says so; there is no opt-out
-- (owner, 2026-10-05). Nothing reads the events for scoring: admins read accept rates by mode and position.
--
-- One row per list shown (`shown`: its cards in order) and one per decision on a card from it (`accepted`, `declined`:
-- the card and its place in the list). A batch is a client-generated id per list shown, so a decision names the list it
-- answers. A card decided twice in one batch (passed on, then taken) keeps the last decision.

create table public.rec_events (
  id bigint generated always as identity primary key,
  voter_key text not null, -- 'u:<user id>' when signed in, otherwise 'v:<salted visitor hash>'; 'x:<random>' after deletion
  user_id uuid references auth.users (id) on delete set null,
  batch_id uuid not null,
  kind text not null check (kind in ('shown', 'accepted', 'declined')),
  mode text not null check (mode in ('add', 'cut', 'swap', 'build')),
  card_ids integer[] not null check (cardinality(card_ids) between 1 and 120),
  position smallint check (position between 0 and 119),
  target_card_id integer, -- swaps: the card being replaced
  commander_ids integer[] not null default '{}' check (cardinality(commander_ids) <= 2),
  bracket smallint check (bracket between 1 and 5),
  collection text not null check (collection in ('none', 'only', 'first')),
  components jsonb, -- decisions: the card's score components as shown
  created_at timestamptz not null default now(),
  check ((kind = 'shown') = (position is null)),
  check (kind = 'shown' or cardinality(card_ids) = 1)
);

create index rec_events_mode_created on public.rec_events (mode, created_at);
create unique index rec_events_shown on public.rec_events (voter_key, batch_id) where kind = 'shown';
create unique index rec_events_decision on public.rec_events (voter_key, batch_id, (card_ids[1])) where kind <> 'shown';

-- Writes go through record_rec_event only; API roles get no direct access, and there are no API reads.
alter table public.rec_events enable row level security;
grant all on public.rec_events to service_role;

-- A swipe a second at most, plus the lists they come from.
update public.app_config
set value = value || '{"events": {"limit": 240, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits' and not value ? 'events';

-- Records one event. Raises VOTER_REQUIRED or INVALID_EVENT. A list recorded again (same batch) or a decision repeated
-- writes nothing new; a changed decision replaces the old one.
create function public.record_rec_event(
  p_visitor_key text,
  p_batch_id uuid,
  p_kind text,
  p_mode text,
  p_card_ids integer[],
  p_position smallint default null,
  p_target_card_id integer default null,
  p_commander_ids integer[] default '{}',
  p_bracket smallint default null,
  p_collection text default 'none',
  p_components jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  voter text;
begin
  if auth.uid() is not null then
    voter := 'u:' || auth.uid()::text;
  elsif coalesce(p_visitor_key, '') <> '' then
    voter := 'v:' || p_visitor_key;
  else
    raise exception 'VOTER_REQUIRED';
  end if;

  if p_batch_id is null
     or p_kind is null or p_kind not in ('shown', 'accepted', 'declined')
     or p_mode is null or p_mode not in ('add', 'cut', 'swap', 'build')
     or coalesce(p_collection, '') not in ('none', 'only', 'first')
     or cardinality(coalesce(p_card_ids, '{}')) not between 1 and 120
     or (p_kind <> 'shown' and (cardinality(p_card_ids) <> 1 or p_position is null or p_position not between 0 and 119))
     or (p_kind = 'shown' and p_position is not null)
     or cardinality(coalesce(p_commander_ids, '{}')) > 2
     or (p_bracket is not null and p_bracket not between 1 and 5)
     or (p_components is not null and (jsonb_typeof(p_components) <> 'object' or length(p_components::text) > 500)) then
    raise exception 'INVALID_EVENT';
  end if;

  if p_kind = 'shown' then
    insert into public.rec_events (voter_key, user_id, batch_id, kind, mode, card_ids, target_card_id, commander_ids, bracket, collection)
    values (voter, auth.uid(), p_batch_id, 'shown', p_mode, p_card_ids, p_target_card_id, coalesce(p_commander_ids, '{}'), p_bracket, p_collection)
    on conflict (voter_key, batch_id) where kind = 'shown' do nothing;
  else
    insert into public.rec_events as e (
      voter_key, user_id, batch_id, kind, mode, card_ids, position, target_card_id, commander_ids, bracket, collection, components
    )
    values (
      voter, auth.uid(), p_batch_id, p_kind, p_mode, p_card_ids, p_position, p_target_card_id,
      coalesce(p_commander_ids, '{}'), p_bracket, p_collection, p_components
    )
    on conflict (voter_key, batch_id, (card_ids[1])) where kind <> 'shown' do update set
      kind = excluded.kind,
      position = excluded.position,
      components = excluded.components,
      created_at = now()
    where e.kind is distinct from excluded.kind;
  end if;
end;
$$;

revoke execute on function public.record_rec_event(text, uuid, text, text, integer[], smallint, integer, integer[], smallint, text, jsonb) from public;
grant execute on function public.record_rec_event(text, uuid, text, text, integer[], smallint, integer, integer[], smallint, text, jsonb)
  to anon, authenticated, service_role;

-- A deleted account's events stay, re-keyed like its votes: one fresh key per account, nothing naming the person.
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'x:' || gen_random_uuid()::text;
begin
  update public.swap_votes
  set voter_key = v_key, user_id = null
  where voter_key = 'u:' || old.id::text or user_id = old.id;
  update public.rec_events
  set voter_key = v_key, user_id = null
  where voter_key = 'u:' || old.id::text or user_id = old.id;
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

-- Accept rate per mode and position over the last p_days days: how often each place in a list was shown, taken and
-- passed on. Positions past p_max_position are left out. Platform admins only.
create function public.admin_rec_accept_rates(
  p_days integer default 30,
  p_mode text default null,
  p_max_position integer default 20
)
returns table (mode text, "position" integer, shown bigint, accepted bigint, declined bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
  with recent as (
    select e.* from public.rec_events e
    where e.created_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
      and (p_mode is null or e.mode = p_mode)
  ),
  shown as (
    select r.mode, p.i - 1 as pos, count(*) as n
    from recent r, generate_subscripts(r.card_ids, 1) as p(i)
    where r.kind = 'shown' and p.i - 1 < p_max_position
    group by r.mode, p.i - 1
  ),
  decided as (
    select r.mode, r.position::integer as pos,
           count(*) filter (where r.kind = 'accepted') as accepted,
           count(*) filter (where r.kind = 'declined') as declined
    from recent r
    where r.kind <> 'shown' and r.position < p_max_position
    group by r.mode, r.position
  )
  select coalesce(s.mode, d.mode), coalesce(s.pos, d.pos), coalesce(s.n, 0), coalesce(d.accepted, 0), coalesce(d.declined, 0)
  from shown s
  full join decided d on d.mode = s.mode and d.pos = s.pos
  order by 1, 2;
end;
$$;

revoke execute on function public.admin_rec_accept_rates(integer, text, integer) from public, anon;
grant execute on function public.admin_rec_accept_rates(integer, text, integer) to authenticated, service_role;
