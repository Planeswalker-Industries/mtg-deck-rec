-- The admin home's site numbers in one read: accounts, saved decks, collections, recent imports and the open
-- reports and error tickets. Live counts on every load, no stored snapshots: every count is a small table or an
-- index read, and the home page asks once per visit.
--
-- One jsonb value, so PostgREST's row cap can't touch it. Stable and audit-free: it reads counts, never a player's data.

-- The deck windows ("+N today", "+N this week") count by creation time; without this they scan every deck.
create index if not exists decks_created_at on public.decks (created_at);

create or replace function public.admin_site_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- "Today" on the home page: the last 24 hours rather than the calendar day, so the count reads the same in every
  -- time zone an admin opens it from.
  c_day constant interval := interval '24 hours';
  -- "This week": the last seven days, for the same reason.
  c_week constant interval := interval '7 days';
  v_users jsonb;
  v_decks jsonb;
  v_collections bigint;
  v_imports bigint;
  v_open jsonb;
begin
  perform public.require_platform_admin();

  -- auth.users is one row per account: small, and the same accounts the Users list shows (deleted ones left out).
  select jsonb_build_object(
           'total', count(*),
           'last24h', count(*) filter (where u.created_at > now() - c_day),
           'last7d', count(*) filter (where u.created_at > now() - c_week)
         )
    into v_users
    from auth.users u
   where u.deleted_at is null;

  -- The total is one count; public uses the decks_public partial index; the windows use decks_created_at.
  select jsonb_build_object(
           'total', (select count(*) from public.decks),
           'public', (select count(*) from public.decks d where d.is_public),
           'last24h', (select count(*) from public.decks d where d.created_at > now() - c_day),
           'last7d', (select count(*) from public.decks d where d.created_at > now() - c_week)
         )
    into v_decks;

  -- Accounts with at least one entry: one probe of collection_items_entry (user_id leads it) per account, never a
  -- walk over the entries themselves.
  select count(*)
    into v_collections
    from auth.users u
   where u.deleted_at is null
     and exists (select 1 from public.collection_items c where c.user_id = u.id);

  -- One row per import a player started; small, and old open ones are pruned by start_collection_import.
  select count(*)
    into v_imports
    from public.collection_imports i
   where i.created_at > now() - c_week;

  -- The same numbers as the header's badges.
  v_open := coalesce(public.admin_open_counts(), '{}'::jsonb);

  return jsonb_build_object(
    'users', v_users,
    'decks', v_decks,
    'collections', v_collections,
    'importsLast7d', v_imports,
    'openReports', coalesce((v_open->>'reports')::bigint, 0),
    'openErrors', coalesce((v_open->>'errors')::bigint, 0)
  );
end;
$$;

revoke execute on function public.admin_site_stats() from public, anon;
grant execute on function public.admin_site_stats() to authenticated, service_role;
