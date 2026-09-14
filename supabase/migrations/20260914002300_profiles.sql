-- Accounts: one profile per signed-up user, created automatically when the user is. People can read their own profile
-- and change its display name; nothing else, and nobody else's.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy own_profile_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy own_profile_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Runs as the table owner so it can insert for a user who has no profile yet.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Sending and checking sign-in codes, per visitor. Supabase Auth applies its own limits on top.
update public.app_config
set value = value || '{"auth": {"limit": 10, "windowSeconds": 600}}'::jsonb, updated_at = now()
where key = 'rate_limits';
