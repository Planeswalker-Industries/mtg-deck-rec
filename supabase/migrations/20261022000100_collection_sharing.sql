-- Shared collections: an account's collection can be opened by anyone who has its link, at /collection/<code>.
--
-- Sharing is off until the owner turns it on, so every collection saved before this stays private. The code is made
-- once, the first time the owner shares, and survives turning sharing off and on again: off makes the link stop
-- working, on brings the same link back. Like a deck's code it is random, never derived from anything about the owner.
--
-- Nobody reads collection_shares directly. The owner goes through set_collection_sharing and my_collection_sharing,
-- and everyone else through shared_collection and collection_share_status, which answer only for a shared code.

create table public.collection_shares (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null default public.new_deck_code()
    constraint collection_shares_code_shape check (char_length(code) between 8 and 32 and code ~ '^[A-Za-z0-9]+$'),
  is_shared boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index collection_shares_code on public.collection_shares (code);

alter table public.collection_shares enable row level security;
-- No policies: only the functions below touch it.

revoke all on public.collection_shares from anon, authenticated;
grant all on public.collection_shares to service_role;

-- A shared collection can hold 100,000 entries and anyone may ask for it, so its reads get their own budget.
update public.app_config
set value = value || '{"shared_collection": {"limit": 30, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

-- Turns sharing on or off for the caller's collection. Returns {code, shared}.
create function public.set_collection_sharing(p_shared boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  insert into public.collection_shares as s (user_id, is_shared)
  values (uid, p_shared)
  on conflict (user_id) do update set is_shared = excluded.is_shared, updated_at = now()
  where s.is_shared is distinct from excluded.is_shared;

  select jsonb_build_object('code', s.code, 'shared', s.is_shared) into result
  from public.collection_shares s where s.user_id = uid;
  return result;
end;
$$;

-- The caller's sharing state, or null when they have never shared.
create function public.my_collection_sharing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('code', s.code, 'shared', s.is_shared)
  from public.collection_shares s
  where s.user_id = (select auth.uid())
$$;

-- A shared collection, folded to one entry per card like my_collection_entries, with the owner's display name. Null
-- when the code is unknown or its collection isn't shared, so a private collection can't be told from a missing one.
create function public.shared_collection(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'displayName', p.display_name,
    'entries', (
      select coalesce(
        jsonb_agg(jsonb_build_object('cardId', e.card_id, 'quantity', e.quantity, 'setCodes', e.set_codes) order by e.card_id),
        '[]'::jsonb
      )
      from (
        select
          ci.card_id,
          sum(ci.quantity)::integer as quantity,
          coalesce(array_agg(distinct pr.set_code) filter (where pr.set_code is not null), '{}') as set_codes
        from public.collection_items ci
        left join public.printings pr on pr.id = ci.printing_id
        where ci.user_id = s.user_id
        group by ci.card_id
      ) e
    )
  )
  from public.collection_shares s
  left join public.profiles p on p.id = s.user_id
  where s.code = p_code and s.is_shared
$$;

-- What a /collection/<code> link is to the caller: 'mine' (their own, shared or not), 'shared' (someone else's, shared)
-- or null (unknown, or someone else's that isn't shared). For the proxy, which needs a real 404 or a redirect.
create function public.collection_share_status(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.user_id = (select auth.uid()) then 'mine'
    when s.is_shared then 'shared'
  end
  from public.collection_shares s
  where s.code = p_code
$$;

revoke execute on function public.set_collection_sharing(boolean) from public, anon;
revoke execute on function public.my_collection_sharing() from public, anon;
revoke execute on function public.shared_collection(text) from public;
revoke execute on function public.collection_share_status(text) from public;
grant execute on function public.set_collection_sharing(boolean) to authenticated, service_role;
grant execute on function public.my_collection_sharing() to authenticated, service_role;
grant execute on function public.shared_collection(text) to anon, authenticated, service_role;
grant execute on function public.collection_share_status(text) to anon, authenticated, service_role;
