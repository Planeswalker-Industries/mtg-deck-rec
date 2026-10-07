-- The request path reads only the precompute worker's serving tables (T055), and nothing in this release calls the
-- per-request rec functions any more. They are NOT dropped here: this release applies its migrations before its code
-- goes live (the release steps in docs/tasks.md, T055), and until then production runs the previous build, which falls
-- back to rec_add_candidates, rec_swap_candidates and rec_card_roles whenever app_config.recs is missing. Dropping them
-- (with rec_timeouts, log_rec_timeout and the app_config.recs row) is a later migration, once this build is live and a
-- rollback to the previous one is no longer wanted (tasks.md, T067).
--
-- The version stays so local databases that applied an earlier draft of this file keep a consistent history.

select 1;
