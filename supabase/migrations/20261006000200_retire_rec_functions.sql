-- The request path reads only the precompute worker's serving tables (T055). Retired here, after the switch
-- (`app_config.recs.servingReads`) has run on hosted for more than a week:
--
-- * rec_add_candidates (both overloads) and rec_swap_candidates: per-request scoring in SQL, which averaged 0.8-1.0 s
--   on hosted and peaked at the 3 s anon timeout (T008). serving_add_pool and serving_swap_candidates replaced them.
-- * rec_card_roles: card_roles holds what it answered.
-- * rec_timeouts and log_rec_timeout: the record of those functions running out of retries.
-- * The servingReads switch itself: there is one path now.
--
-- rec_functional_tag_count stays: a swap reads the target's tag count through it.

drop function if exists public.rec_add_candidates(integer[], integer, real, smallint, integer[], boolean, integer[], integer);
drop function if exists public.rec_add_candidates(integer[], real[], real, smallint, integer[], boolean, integer[], integer);
drop function if exists public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer);
drop function if exists public.rec_card_roles(integer[], uuid[]);
drop function if exists public.log_rec_timeout(text, integer, integer[], smallint, boolean);
drop table if exists public.rec_timeouts;

delete from public.app_config where key = 'recs';
