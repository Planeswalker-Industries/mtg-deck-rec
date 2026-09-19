-- Platform admins and the user management they do at /admin.
--
-- Membership is a table, not a claim in the JWT: a revoked admin has to lose access on their next request, not
-- whenever their access token happens to expire. `is_platform_admin()` is the single answer to "may this person
-- administer the platform", and both the row-level policies here and the app's route guards ask it.
--
-- Every admin read and write goes through a security-definer function that checks the *caller*, so the app never
-- needs the service key to run the admin area: the same session cookie that signs someone in is what authorises
-- them. Nothing here is reachable by anon, and a signed-in non-admin gets insufficient_privilege.

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Why this person has it, so the list is auditable a year from now.
  note text check (note is null or char_length(note) between 1 and 200),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Security definer, so the policy below can call it without recursing into the table it guards, and so a
-- non-admin can't learn who the admins are by probing. Stable: one lookup per statement is enough.
create function public.is_platform_admin(p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = coalesce(p_user, (select auth.uid()))
  );
$$;

revoke execute on function public.is_platform_admin(uuid) from public, anon;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

create policy admins_read_admins on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;  -- admins_read_admins
grant all on public.platform_admins to service_role;

-- The admin area's own request budget. Generous, because a list view fires several requests per page, but still a
-- ceiling: an admin session is as stealable as any other.
update public.app_config
set value = value || '{"admin": {"limit": 300, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

-- ---------------------------------------------------------------------------
-- Guard
-- ---------------------------------------------------------------------------

-- Raised as insufficient_privilege (42501) so callers can tell "you may not" from "that didn't work".
create function public.require_platform_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_platform_admin(v_actor) then
    raise exception 'Not a platform admin.' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke execute on function public.require_platform_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading users
-- ---------------------------------------------------------------------------

-- One function serves the list, the search, the filters and the single-user view: React Admin's getOne is just a
-- list of one, and keeping it to one function keeps the column set and the guard in one place.
--
-- `total_count` rides along as a window function so a page and its total cost one round trip instead of two.
--
-- Ordering is done with per-type sort keys rather than dynamic SQL, so no caller-supplied text ever reaches the
-- planner. It sorts without an index; the user table is the smallest in the database and this runs for admins only.
create function public.admin_list_users(
  p_user_id uuid default null,
  p_search text default null,
  p_admins_only boolean default false,
  p_sort text default 'created_at',
  p_ascending boolean default false,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id uuid,
  email text,
  display_name text,
  is_admin boolean,
  admin_note text,
  admin_since timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deck_count integer,
  collection_count integer,
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
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_platform_admin();

  return query
  with base as (
    select
      u.id,
      u.email::text as email,
      p.display_name,
      (a.user_id is not null) as is_admin,
      a.note as admin_note,
      a.created_at as admin_since,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      (select count(*)::integer from public.decks d where d.user_id = u.id) as deck_count,
      (select count(*)::integer from public.collection_items c where c.user_id = u.id) as collection_count
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.platform_admins a on a.user_id = u.id
    where u.deleted_at is null
      and (p_user_id is null or u.id = p_user_id)
      and (not coalesce(p_admins_only, false) or a.user_id is not null)
      and (
        v_search is null
        or u.email::text ilike '%' || v_search || '%'
        or coalesce(p.display_name, '') ilike '%' || v_search || '%'
        or u.id::text = v_search
      )
  ),
  keyed as (
    select
      base.*,
      count(*) over () as total_count,
      case p_sort when 'email' then lower(base.email) when 'display_name' then lower(coalesce(base.display_name, '')) end as sort_text,
      case p_sort when 'last_sign_in_at' then base.last_sign_in_at when 'admin_since' then base.admin_since when 'created_at' then base.created_at end as sort_time,
      case p_sort when 'deck_count' then base.deck_count when 'collection_count' then base.collection_count end as sort_num
    from base
  )
  select
    keyed.id, keyed.email, keyed.display_name, keyed.is_admin, keyed.admin_note, keyed.admin_since,
    keyed.created_at, keyed.last_sign_in_at, keyed.email_confirmed_at, keyed.banned_until,
    keyed.deck_count, keyed.collection_count, keyed.total_count
  from keyed
  order by
    case when p_ascending then keyed.sort_text end asc nulls last,
    case when not p_ascending then keyed.sort_text end desc nulls last,
    case when p_ascending then keyed.sort_time end asc nulls last,
    case when not p_ascending then keyed.sort_time end desc nulls last,
    case when p_ascending then keyed.sort_num end asc nulls last,
    case when not p_ascending then keyed.sort_num end desc nulls last,
    keyed.created_at desc,
    keyed.id
  offset v_offset
  limit v_limit;
end;
$$;

revoke execute on function public.admin_list_users(uuid, text, boolean, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_list_users(uuid, text, boolean, text, boolean, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

-- Granting and revoking platform admin. Two rules that cannot be argued with from the UI:
-- you cannot revoke yourself (nobody locks themselves out by misclicking a toggle), and the last admin cannot be
-- revoked at all (an admin area with no admins needs a database session to fix).
create function public.admin_set_platform_admin(p_user_id uuid, p_is_admin boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
begin
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null) then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  if p_is_admin then
    insert into public.platform_admins (user_id, note, granted_by)
    values (p_user_id, nullif(btrim(coalesce(p_note, '')), ''), v_actor)
    on conflict (user_id) do update
      set note = excluded.note
      where platform_admins.note is distinct from excluded.note;
  else
    if p_user_id = v_actor then
      raise exception 'You cannot remove your own platform admin access.' using errcode = 'check_violation';
    end if;
    delete from public.platform_admins where user_id = p_user_id;
    -- Checked after the delete, not before, so revoking someone who was never an admin stays a harmless no-op
    -- instead of tripping the count. The self-check above already makes this unreachable; it is the backstop.
    if not exists (select 1 from public.platform_admins) then
      raise exception 'The last platform admin cannot be removed.' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, case when p_is_admin then 'admin.grant' else 'admin.revoke' end, jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke execute on function public.admin_set_platform_admin(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_platform_admin(uuid, boolean, text) to authenticated, service_role;

-- Display names are shown on public deck pages, so an admin can clear an abusive one without touching the account.
create function public.admin_set_display_name(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if v_name is not null and char_length(v_name) > 60 then
    raise exception 'A display name is at most 60 characters.' using errcode = 'check_violation';
  end if;

  update public.profiles set display_name = v_name, updated_at = now()
  where id = p_user_id and display_name is distinct from v_name;

  if not found and not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.display_name', jsonb_build_object('user_id', p_user_id, 'display_name', v_name));
end;
$$;

revoke execute on function public.admin_set_display_name(uuid, text) from public, anon;
grant execute on function public.admin_set_display_name(uuid, text) to authenticated, service_role;

-- Banning is the reversible answer to a bad account; deleting is not. GoTrue refuses to issue a session while
-- banned_until is in the future, and a far-future date reads the same as "until someone lifts it" without relying
-- on how infinity is compared.
create function public.admin_set_user_banned(p_user_id uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
begin
  if p_user_id = v_actor then
    raise exception 'You cannot ban your own account.' using errcode = 'check_violation';
  end if;
  if p_banned and public.is_platform_admin(p_user_id) then
    raise exception 'Remove platform admin access before banning this account.' using errcode = 'check_violation';
  end if;

  update auth.users
  set banned_until = case when p_banned then now() + interval '100 years' end, updated_at = now()
  where id = p_user_id and deleted_at is null;

  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, case when p_banned then 'admin.ban' else 'admin.unban' end, jsonb_build_object('user_id', p_user_id));
end;
$$;

revoke execute on function public.admin_set_user_banned(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_banned(uuid, boolean) to authenticated, service_role;

-- Deleting an account takes its profile, decks, collection and votes with it through the existing cascades. The
-- email is captured into the audit row first, because afterwards there is nothing left to name who was removed.
create function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_email text;
begin
  if p_user_id = v_actor then
    raise exception 'You cannot delete your own account here.' using errcode = 'check_violation';
  end if;
  if public.is_platform_admin(p_user_id) then
    raise exception 'Remove platform admin access before deleting this account.' using errcode = 'check_violation';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if v_email is null then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.delete_user', jsonb_build_object('user_id', p_user_id, 'email', v_email));

  delete from auth.users where id = p_user_id;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, service_role;
