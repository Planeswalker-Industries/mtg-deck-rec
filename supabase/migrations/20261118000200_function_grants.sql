-- Functions the API roles were never meant to run. Hosted's default privileges in `public` give every new function to
-- anon, authenticated and service_role, and our migrations only revoked from `public`, so on hosted anon (anyone with
-- the publishable key) could run these security-definer functions; a local database never could, since the Supabase
-- CLI's defaults grant new functions to no one. Found 2026-11-18 with has_function_privilege('anon', ...) over pg_proc.
--
-- - The worker's (it connects as postgres): the deck lookups' four and the two pool readers the scores pass uses.
--   commander_request_recent returned whole request rows, client keys included, and the pool readers are heavy queries.
-- - The saved-deck writes keep authenticated: they act on auth.uid()'s own decks, which anon has none of.
--
-- precompute_substitutes is revoked in 20261118000100_substitutes_faster.sql.

revoke execute on function public.commander_collector_online() from public, anon, authenticated;
revoke execute on function public.commander_request_config() from public, anon, authenticated;
revoke execute on function public.commander_request_json(public.commander_requests, text) from public, anon, authenticated;
revoke execute on function public.commander_request_recent(integer) from public, anon, authenticated;
revoke execute on function public.serving_commander_pool(integer, integer, smallint, integer[], boolean, integer[], integer) from public, anon, authenticated;
revoke execute on function public.serving_partner_pool(integer, integer, smallint, integer[], boolean, integer[], integer) from public, anon, authenticated;

revoke execute on function public.duplicate_deck(uuid, text) from public, anon;
revoke execute on function public.rename_deck(uuid, text) from public, anon;
revoke execute on function public.set_deck_built(uuid, boolean) from public, anon;
revoke execute on function public.set_deck_visibility(uuid, boolean) from public, anon;
grant execute on function public.duplicate_deck(uuid, text) to authenticated;
grant execute on function public.rename_deck(uuid, text) to authenticated;
grant execute on function public.set_deck_built(uuid, boolean) to authenticated;
grant execute on function public.set_deck_visibility(uuid, boolean) to authenticated;

-- The cause: from here on a new function in `public` reaches the API roles only through its migration's grants, as on a
-- local database (whose `public` defaults for postgres hold postgres alone). Every migration grants explicitly
-- (CLAUDE.md), so nothing that works locally changes. This covers the functions postgres creates, which is every
-- migration's; Supabase's own role keeps its defaults. Postgres's built-in grant to PUBLIC can't be revoked per schema,
-- which is why every migration also revokes from public.
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;
