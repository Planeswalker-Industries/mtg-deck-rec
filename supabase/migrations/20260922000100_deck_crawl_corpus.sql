-- Scraped commander decks (Moxfield, Archidekt) and their crawl bookkeeping.
--
-- The Go API on the VPS (services/search-api) scrapes each source on a daily trigger from the web app and writes
-- decklists here through the Supabase REST API. Moxfield is built but blocked (Cloudflare WAF, 2026-09-22); Archidekt
-- is active. This schema is private on purpose: third-party decklists never reach the API roles (same stance as the
-- card-graph plan's `corpus` schema), and no app read path touches it yet. Aggregating these decks into the
-- popularity metrics is the follow-up milestone, which is why the rows live at oracle level (commanders + cards as
-- oracle ids) with change detection by content hash.

create schema if not exists corpus;

-- A scraped deck, oracle-level. resolveDeck / identity / legality filtering and commander-format qualification are
-- the aggregation milestone's job (the worker owns those pure functions); this table is the raw scrape result.
create table corpus.decks (
  id bigint generated always as identity primary key,
  source text not null check (source in ('moxfield', 'archidekt')),
  source_deck_id text not null,           -- Moxfield slug, or Archidekt numeric deck id
  commanders text[] not null,             -- oracle ids, sorted (one or a partner pair)
  cards text[] not null,                  -- oracle ids, the rest of the list as scraped
  content_hash text not null,             -- sha256 over commanders + cards: what "changed" means
  listed_updated_at timestamptz not null, -- the feed's updated value, as listed
  last_updated_at timestamptz not null,   -- the deck's authoritative updated value
  fetched_at timestamptz not null default now(),
  unique (source, source_deck_id)
);

-- Run bookkeeping, shaped like sync_runs: one row per crawl with what it saw and did.
create table corpus.crawl_runs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('moxfield', 'archidekt')),
  state text not null check (state in ('queued', 'running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_seen int not null default 0,
  decks_listed int not null default 0,
  decks_fetched int not null default 0,
  decks_written int not null default 0,
  skipped_unchanged int not null default 0,
  blocks int not null default 0,
  error text
);

-- One row per source: the crawl cursor, the single-flight claim, and the kill switch. Re-enabling a blocked source
-- is a manual update on its row.
create table corpus.crawl_state (
  source text primary key check (source in ('moxfield', 'archidekt')),
  next_page int not null default 1,
  last_deck_id text,              -- the newest deck reached on the list, to stop at "already current"
  running_run_id bigint,          -- single-flight: one crawl at a time
  client_id text,                 -- the container that claimed it, so stale claims can be aged out
  disabled boolean not null default false,
  disabled_reason text,
  disabled_at timestamptz,
  probe_ok_at timestamptz         -- when the connectivity probe last passed
);

insert into corpus.crawl_state (source) values ('moxfield'), ('archidekt');

alter table corpus.decks enable row level security;
alter table corpus.crawl_runs enable row level security;
alter table corpus.crawl_state enable row level security;

-- Writes come only from the Go API's service_role key. No anon or authenticated grants: the
-- groomed aggregates already live in `public`, and third-party decklists never do.
grant select, insert, update, delete on all tables in schema corpus to service_role;
alter default privileges in schema corpus grant select, insert, update, delete on tables to service_role;

-- Crawl policy. Anti-abuse thresholds belong in app_config (the repo is public), and the Go
-- crawlers read their row at run start (key = source name). requestIntervalMs is the polite
-- pace; maxDecksPerRun bounds a single crawl; backfillDecks is the budget for the first-ever
-- run; backoffStartMs/maxMs shape the retry pause on 429/5xx. There is deliberately no "how
-- many blocks" knob: a single 403 or challenge is a definitive block and flips that source off
-- until re-enabled by hand.
--
-- Moxfield: built, blocked; a 1000 ms pace is the polite default it would use if access is ever
-- granted. Archidekt: active; one request a second drew 429s on 2026-09-14 (worker evidence), so
-- the default pace is 3000 ms.
insert into public.app_config (key, value, is_public)
values
  ('moxfield', '{"requestIntervalMs": 1000, "maxDecksPerRun": 500, "backfillDecks": 10000, "backoffStartMs": 5000, "backoffMaxMs": 300000}'::jsonb, false),
  ('archidekt', '{"requestIntervalMs": 3000, "maxDecksPerRun": 1000, "backfillDecks": 10000, "backoffStartMs": 5000, "backoffMaxMs": 300000}'::jsonb, false)
on conflict (key) do update set value = excluded.value, updated_at = now();