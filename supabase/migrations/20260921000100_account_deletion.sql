-- Account deletion (T004): a signed-in user can delete their own account, and every way an account is deleted — this,
-- the admin area's admin_delete_user, the dashboard, auth.admin.deleteUser — forgets the same things.
--
-- What goes, through cascades that already exist on auth.users:
--   profiles, decks → deck_cards, collection_items, collection_imports → collection_import_rows, platform_admins.
-- What stays, with nothing left that points at the person:
--   swap_votes, re-keyed below. They are the swap-quality signal, and a vote says nothing about who cast it once its
--   key is gone. Corpus aggregates hold counts, never user ids.

-- A tag disabled by an admin who later deletes their account would otherwise block the delete: the column had no
-- ON DELETE action. The switch stays off; only who flipped it is forgotten.
alter table public.tags drop constraint tags_disabled_by_fkey;
alter table public.tags
  add constraint tags_disabled_by_fkey foreign key (disabled_by) references auth.users (id) on delete set null;

-- swap_votes.user_id already goes null on delete, but voter_key still read 'u:<user id>'. One fresh key per deleted
-- account keeps that account's votes grouped (the unique key is voter + pair, and a later aggregation may want to
-- weigh a voter's votes together) without naming anyone. A trigger rather than code in each delete path, so no path
-- can forget it.
create function public.handle_deleted_user()
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
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.handle_deleted_user();

-- Deletes the caller's own account. Acts on auth.uid() only and takes no arguments, so it can never reach anyone
-- else. The last platform admin is refused: there is no way to make the first admin through the app, so losing the
-- last one would take SQL to recover.
--
-- The audit row keeps the email and user id, like admin_delete_user does (owner decision 2026-09-21): a deleted
-- account's address stays on file so repeat accounts and banned users signing up again can be recognised. The
-- privacy policy (/privacy) says so.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_decks integer;
  v_collection integer;
begin
  if v_user is null then
    raise exception 'Sign in to delete your account.' using errcode = 'insufficient_privilege';
  end if;

  if public.is_platform_admin(v_user)
    and not exists (select 1 from public.platform_admins where user_id <> v_user) then
    raise exception 'You are the only platform admin. Make someone else an admin before deleting your account.'
      using errcode = 'check_violation';
  end if;

  select u.email::text into v_email from auth.users u where u.id = v_user;

  select count(*) into v_decks from public.decks where user_id = v_user;
  select count(*) into v_collection from public.collection_items where user_id = v_user;

  insert into public.audit_log (actor, action, payload)
  values (
    v_user,
    'account.delete_self',
    jsonb_build_object(
      'user_id', v_user, 'email', v_email,
      'decks', v_decks, 'collection_items', v_collection
    )
  );

  delete from auth.users where id = v_user;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;
