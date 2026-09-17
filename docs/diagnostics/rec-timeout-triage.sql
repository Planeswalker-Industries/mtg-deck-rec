-- ============================================================================
-- Triage: rec_add_candidates / rec_swap_candidates hitting the anon 3 s timeout
-- ============================================================================
--
-- Question this answers: is the time being spent inside Postgres, or between
-- the app and Postgres? Sections 1-4 are global checks. Sections 5-7 rebuild
-- the exact arguments the web app sends for one commander and time that call,
-- which is the comparison that actually settles it.
--
-- Run as a superuser/postgres role (Supabase SQL editor, or psql with the
-- session pooler string). Sections 1-6 are READ-ONLY. Section 7 runs the real
-- query. Section 8 changes things and is commented out on purpose.
--
-- Only edit needed: the commander slug in sections 5 and 6, and the card name
-- in section 7. Defaults use Rograkh, the reported case.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Are the per-function planner settings still attached?
-- ---------------------------------------------------------------------------
-- `create or replace` silently drops proconfig. Both rec functions depend on
-- enable_nestloop=off; without it their argument-dependent CTEs (estimated at
-- ~1 row) plan as nested loops and go from ~40 ms to seconds.
-- EXPECT: one row per overload, has_nestloop_off = true on every one.
-- Note there are TWO rec_add_candidates overloads live: the p_key_weights one
-- is what the app calls; the older p_deck_count one is legacy.

select p.oid::regprocedure                        as function,
       l.lanname                                  as language,
       p.proconfig                                as settings,
       ('enable_nestloop=off' = any(p.proconfig)) as has_nestloop_off
from pg_proc p
join pg_language l  on l.oid = p.prolang
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rec_add_candidates', 'rec_swap_candidates')
order by 1;


-- ---------------------------------------------------------------------------
-- 2. What timeout do the API roles actually run under?
-- ---------------------------------------------------------------------------
-- EXPECT: anon carries statement_timeout=3s. Confirms the ceiling the app hits.

select r.rolname                          as role,
       coalesce(s.setconfig::text, '(none)') as role_settings
from pg_roles r
left join pg_db_role_setting s on s.setrole = r.oid
where r.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')
order by r.rolname;


-- ---------------------------------------------------------------------------
-- 3. Planner statistics freshness
-- ---------------------------------------------------------------------------
-- The sync jobs never ANALYZE explicitly. After a bulk load, stale stats make
-- the planner mis-estimate these exact tables.
-- LOOK FOR: last_analyze / last_autoanalyze that are null, or older than the
-- last sync run (section 4b).

select relname                as table_name,
       n_live_tup             as live_rows,
       last_analyze,
       last_autoanalyze,
       last_vacuum,
       last_autovacuum
from pg_stat_user_tables
where relname in ('cards', 'card_tags', 'tag_closure', 'printings', 'card_stats',
                  'commander_card_stats', 'commander_keys', 'commander_stats',
                  'card_global_stats')
order by coalesce(last_analyze, last_autoanalyze) nulls first;


-- 3b. When did the syncs last finish? Compare against the analyze times above.
select job, status, started_at, finished_at, finished_at - started_at as took
from sync_runs
order by started_at desc
limit 10;


-- ---------------------------------------------------------------------------
-- 4. THE DECIDING CHECK: server-side execution time of the real calls
-- ---------------------------------------------------------------------------
-- pg_stat_statements measures time spent INSIDE Postgres only. It is recorded
-- for the calls PostgREST actually makes, so it is immune to the "I typed
-- different arguments" problem.
--
--   mean ~200-550 ms  -> the query is fine; the latency is transport/app layer
--   mean ~1-2.5 s     -> it IS the query, and the direct comparison was wrong
--
-- For a clean window: run section 8c to reset, load the Rograkh commander page
-- 5-10 times in a browser, then run this.

select calls,
       round(mean_exec_time::numeric, 1)          as ms_mean,
       round(max_exec_time::numeric, 1)           as ms_max,
       round(total_exec_time::numeric / 1000, 1)  as s_total,
       rows,
       left(query, 120)                           as query
from extensions.pg_stat_statements
where (query ilike '%rec_add_candidates%' or query ilike '%rec_swap_candidates%')
  and query !~* '^\s*(create|grant|revoke|alter|comment|drop|prepare)'
order by mean_exec_time desc
limit 20;

-- If the above errors with "relation does not exist", find where the extension
-- lives and re-run with that schema:
--   select extnamespace::regnamespace as schema from pg_extension where extname = 'pg_stat_statements';


-- ---------------------------------------------------------------------------
-- 5. How many corpus keys does this commander actually pass?
-- ---------------------------------------------------------------------------
-- Mirrors pickCorpusSources() in packages/core/src/scoring/corpus.ts:
--   * every key with decks that shares a commander with this one
--   * own key weight 1; the rest weight partnerPoolWeight
--   * borrowed keys are only included when the own key is under minDecks
-- The function's cost scales with this row count. A commander with 25 pairings
-- is doing far more work than a hand-typed 1-2 key test call.
-- >>> EDIT THE SLUG <<<

with params as (select 'rograkh-the-nivvix-wrangler'::text as slug),
settings as (
  select coalesce((value->>'minDecks')::int, 50)             as min_decks,
         coalesce((value->>'partnerPoolWeight')::real, 0.25) as pool_weight
  from app_config where key = 'corpus'
),
target as (select k.* from commander_keys k join params p on k.slug = p.slug),
cmd as (select array_remove(array[t.commander_1, t.commander_2], null) as ids from target t),
pool as (
  select k.id, k.slug, s.deck_count,
         (k.commander_1 = t.commander_1
          and k.commander_2 is not distinct from t.commander_2) as is_own
  from commander_keys k
  join commander_stats s on s.commander_key_id = k.id
  cross join target t
  cross join cmd
  where s.deck_count > 0
    and (k.commander_1 = any(cmd.ids) or k.commander_2 = any(cmd.ids))
),
borrowing as (
  select (select coalesce(max(deck_count), 0) from pool where is_own)
         < (select min_decks from settings) as yes
)
select p.id      as commander_key_id,
       p.slug,
       p.deck_count,
       p.is_own,
       case when p.is_own then 1.0 else (select pool_weight from settings) end as weight
from pool p, borrowing b
where p.is_own or b.yes
order by p.is_own desc, p.deck_count desc;

-- 5b. One-line summary: key count is the number that matters.
with params as (select 'rograkh-the-nivvix-wrangler'::text as slug),
settings as (
  select coalesce((value->>'minDecks')::int, 50)             as min_decks,
         coalesce((value->>'partnerPoolWeight')::real, 0.25) as pool_weight
  from app_config where key = 'corpus'
),
target as (select k.* from commander_keys k join params p on k.slug = p.slug),
cmd as (select array_remove(array[t.commander_1, t.commander_2], null) as ids from target t),
pool as (
  select k.id, s.deck_count,
         (k.commander_1 = t.commander_1
          and k.commander_2 is not distinct from t.commander_2) as is_own
  from commander_keys k
  join commander_stats s on s.commander_key_id = k.id
  cross join target t cross join cmd
  where s.deck_count > 0
    and (k.commander_1 = any(cmd.ids) or k.commander_2 = any(cmd.ids))
),
borrowing as (
  select (select coalesce(max(deck_count), 0) from pool where is_own)
         < (select min_decks from settings) as yes
)
select (select count(*) from pool p, borrowing b where p.is_own or b.yes) as keys_passed,
       (select coalesce(sum(deck_count), 0) from pool where is_own)       as own_decks,
       (select coalesce(sum(deck_count), 0) from pool p, borrowing b
         where not p.is_own and b.yes)                                    as borrowed_decks,
       (select yes from borrowing)                                        as uses_rec_add_candidates;
-- uses_rec_add_candidates = false means the page reads commander_card_stats by
-- index and never calls the function at all. That is why only partner-borrow
-- commanders show this problem.


-- ---------------------------------------------------------------------------
-- 6. Generate the exact call the app makes, ready to EXPLAIN
-- ---------------------------------------------------------------------------
-- Copy the single text value this returns, then run it in section 7.
-- >>> EDIT THE SLUG (same one as section 5) <<<

with params as (select 'rograkh-the-nivvix-wrangler'::text as slug),
settings as (
  select coalesce((value->>'minDecks')::int, 50)             as min_decks,
         coalesce((value->>'partnerPoolWeight')::real, 0.25) as pool_weight,
         coalesce((value->>'shrinkAlpha')::real, 20)         as alpha
  from app_config where key = 'corpus'
),
target as (select k.* from commander_keys k join params p on k.slug = p.slug),
cmd as (select array_remove(array[t.commander_1, t.commander_2], null) as ids from target t),
pool as (
  select k.id, s.deck_count,
         (k.commander_1 = t.commander_1
          and k.commander_2 is not distinct from t.commander_2) as is_own
  from commander_keys k
  join commander_stats s on s.commander_key_id = k.id
  cross join target t cross join cmd
  where s.deck_count > 0
    and (k.commander_1 = any(cmd.ids) or k.commander_2 = any(cmd.ids))
),
borrowing as (
  select (select coalesce(max(deck_count), 0) from pool where is_own)
         < (select min_decks from settings) as yes
),
sources as (
  select p.id, p.is_own,
         case when p.is_own then 1.0 else (select pool_weight from settings) end as weight
  from pool p, borrowing b
  where p.is_own or b.yes
  order by p.is_own desc, p.deck_count desc
)
select format(
  E'begin;\nset local role anon;\nset local statement_timeout = \'30s\';\nexplain (analyze, buffers, verbose)\nselect * from public.rec_add_candidates(\n  %L::int[],   -- p_key_ids (%s keys)\n  %L::real[],  -- p_key_weights\n  %s::real,    -- p_alpha\n  %s::smallint,-- p_identity_mask\n  %L::int[],   -- p_exclude (the commanders)\n  true,        -- p_allow_game_changers\n  null,        -- p_owned\n  500          -- p_limit (TOP_POOL)\n);\nrollback;',
  (select array_agg(id order by is_own desc) from sources),
  (select count(*) from sources),
  (select array_agg(weight order by is_own desc) from sources),
  (select alpha from settings),
  (select color_identity from target),
  (select ids from cmd)
) as run_this;


-- ---------------------------------------------------------------------------
-- 7. Run it and read the plan
-- ---------------------------------------------------------------------------
-- Paste the output of section 6 here and run it in a fresh session.
--
-- The generated snippet is wrapped in begin/rollback on purpose: SET LOCAL is
-- a no-op outside a transaction block, and without the raised timeout EXPLAIN
-- ANALYZE is killed at 3 s and you learn nothing. `set local role anon` matters
-- because permissions and RLS both depend on the role. Nothing is written, and
-- the rollback makes that explicit.
--
-- IN THE PLAN, LOOK FOR:
--   * "Execution Time" vs what pg_stat_statements reported in section 4.
--     Close together -> the query owns the latency. Far apart -> transport.
--   * Any "Nested Loop" node -> enable_nestloop=off got dropped (section 1).
--   * Rows Removed by Filter in the millions, or a Seq Scan on card_tags /
--     tag_closure / commander_card_stats -> stats or index problem.
--   * "Buffers: read=" much larger than "hit=" -> cold cache, not the plan.
--     Run it twice; if pass two is fast, it is Free-tier IO, not the query.

-- 7b. Same for the swap function. >>> EDIT THE CARD NAME <<<
select format(
  E'begin;\nset local role anon;\nset local statement_timeout = \'30s\';\nexplain (analyze, buffers, verbose)\nselect * from public.rec_swap_candidates(%s, \'{}\'::int[], %s::smallint, true, null, 120);\nrollback;',
  c.id, c.color_identity
) as run_this
from cards c
where c.name = 'Sol Ring'
limit 1;


-- ---------------------------------------------------------------------------
-- 8. Remediation -- COMMENTED OUT. Agree before running any of these.
-- ---------------------------------------------------------------------------

-- 8a. If section 3 showed stale stats. Safe, online, no locks that block reads.
--     Run this FIRST if stats are stale, then re-measure before changing anything else.
-- analyze public.cards;
-- analyze public.card_tags;
-- analyze public.tag_closure;
-- analyze public.commander_card_stats;
-- analyze public.card_global_stats;

-- 8b. If section 1 showed a missing setting, reattach it (adjust the signature
--     to match what section 1 printed):
-- alter function public.rec_add_candidates(int[], real[], real, smallint, int[], boolean, int[], int)
--   set enable_nestloop = off;
-- alter function public.rec_swap_candidates(int, int[], smallint, boolean, int[], int)
--   set enable_nestloop = off;

-- 8c. Reset the statement stats to get a clean measurement window.
-- select extensions.pg_stat_statements_reset();

-- 8d. Stopgap only, and function-scoped rather than loosening the anon role
--     globally. This does not make anything faster -- it converts a 503 into a
--     slow page, and holds a pooler connection open longer on the free tier.
-- alter function public.rec_add_candidates(int[], real[], real, smallint, int[], boolean, int[], int)
--   set statement_timeout = '5s';
