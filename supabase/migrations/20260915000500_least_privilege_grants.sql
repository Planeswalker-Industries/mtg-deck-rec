-- Least-privilege table grants for the API roles, and indexes for the foreign keys that lacked them.
--
-- Supabase's bootstrap sets `alter default privileges in schema public grant all on tables to
-- anon, authenticated`, so every table a migration created inherited INSERT/UPDATE/DELETE/TRUNCATE
-- for both API roles. Only 20260914002400_account_collections.sql revoked them. RLS still denied
-- those writes (no policy for the command means no rows), so nothing was reachable through
-- PostgREST -- but the grant-level backstop was missing, and TRUNCATE is not subject to RLS at all.
--
-- After this migration, privileges match the policies: read-only where a public_read policy exists,
-- owner-scoped where the policy is owner-scoped, nothing where a table has no policy and is reached
-- only through security-definer functions.

-- ---------------------------------------------------------------------------
-- 1. Stop new tables inheriting write access
-- ---------------------------------------------------------------------------
-- Applies to tables created by this role (`postgres`), which is what runs migrations. From here on a
-- migration must grant explicitly, which is what CLAUDE.md already told us to do. Supabase's own
-- default privileges for the supabase_admin role are left alone: they cover Supabase-managed schemas.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- No API role inserts directly -- every write goes through a security-definer function that runs as
-- its owner -- so the sequence grants are unused. Drop this second line if that ever stops being true.

-- ---------------------------------------------------------------------------
-- 2. Reset every public table to no API access
-- ---------------------------------------------------------------------------
-- service_role keeps `grant all` from the original migrations; the worker needs it.

revoke all on public.app_config, public.audit_log, public.card_global_stats, public.card_names,
              public.card_stats, public.card_tags, public.cards, public.collection_import_rows,
              public.collection_imports, public.collection_items, public.commander_card_stats,
              public.commander_keys, public.commander_requests, public.commander_stats,
              public.corpus_identity_stats, public.formats, public.printings, public.profiles,
              public.rate_limit_hits, public.share_import_sources, public.slug_redirects,
              public.swap_votes, public.sync_runs, public.tag_closure, public.tag_edges,
              public.tags, public.worker_status
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Grant back exactly what the policies allow
-- ---------------------------------------------------------------------------

-- 3a. Public catalog and corpus data: `public_read` policy, SELECT for both API roles.
grant select on public.card_global_stats, public.card_names, public.card_stats, public.card_tags,
                public.cards, public.commander_card_stats, public.commander_keys,
                public.commander_stats, public.corpus_identity_stats, public.formats,
                public.printings, public.share_import_sources, public.slug_redirects,
                public.tag_closure, public.tag_edges, public.tags
  to anon, authenticated;

-- 3b. Owner-scoped account data: signed-in users only, matching the own_* policies.
grant select         on public.collection_imports to authenticated;  -- own_collection_imports_read
grant select, delete on public.collection_items   to authenticated;  -- own_collection_items_read/_delete
grant select, update on public.profiles           to authenticated;  -- own_profile_read/_update

-- 3c. No grant on purpose: app_config, audit_log, collection_import_rows, commander_requests,
--     rate_limit_hits, swap_votes, sync_runs, worker_status. These have RLS on and no policy; the
--     app reaches them only through security-definer functions (get_public_config, hit_rate_limit,
--     cast_swap_vote, get_commander_request, request_commander_decks, save_collection_rows, ...),
--     whose execute grants are unchanged.
--
--     Views are deliberately untouched: collection_cards is already security_invoker with SELECT for
--     authenticated, and functional_tags must stay unreadable by API roles.

-- ---------------------------------------------------------------------------
-- 4. Indexes for the unindexed foreign keys
-- ---------------------------------------------------------------------------
-- Without these, every delete in the parent table sequentially scans the child. `aggregate:corpus`
-- deletes commander_keys rows, and the catalog syncs delete cards and printings, so this hits the
-- two tables that grow with usage. Partial where the column is nullable, matching the house style of
-- printings_tcgplayer / swap_votes_session; the planner still uses them for the `col = $1` probe an
-- FK check issues, because that implies not null.

create index if not exists card_names_card on public.card_names (card_id);

create index if not exists collection_items_card      on public.collection_items (card_id);
create index if not exists collection_items_printing  on public.collection_items (printing_id) where printing_id is not null;
create index if not exists collection_items_import    on public.collection_items (import_id)   where import_id is not null;

create index if not exists swap_votes_replacement     on public.swap_votes (replacement_card_id);
create index if not exists swap_votes_commander_key   on public.swap_votes (commander_key_id)  where commander_key_id is not null;
create index if not exists swap_votes_user            on public.swap_votes (user_id)           where user_id is not null;

create index if not exists tags_disabled_by           on public.tags (disabled_by) where disabled_by is not null;
