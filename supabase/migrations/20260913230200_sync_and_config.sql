-- Ingestion bookkeeping, runtime config, and operational tables. Service role only.

create type public.sync_job as enum (
  'scryfall_catalog',
  'oracle_tags',
  'archidekt_crawl',
  'corpus_aggregate',
  'precon_import',
  'vote_aggregate'
);

create type public.sync_status as enum (
  'running',
  'succeeded',
  'skipped_unchanged',
  'failed',
  'failed_sanity',
  'abandoned'
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  job public.sync_job not null,
  status public.sync_status not null default 'running',
  source_uri text,
  source_updated_at timestamptz, -- Scryfall bulk updated_at; the next run skips if unchanged
  worker_id text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read bigint not null default 0,
  rows_changed bigint not null default 0,
  checkpoint jsonb,
  metrics jsonb, -- counts compared by sanity gates against the previous successful run
  error text
);

-- At most one running run per job. A run whose heartbeat goes stale is marked 'abandoned' by the next run.
create unique index sync_runs_one_running on public.sync_runs (job) where status = 'running';
create index sync_runs_job_recent on public.sync_runs (job, started_at desc);

-- Scoring weights, thresholds and anti-abuse settings. Lives in the database because the repo is public.
create table public.app_config (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

create unlogged table public.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (key, window_start)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- RLS on with no policies: only the service role can read or write.
alter table public.sync_runs enable row level security;
alter table public.app_config enable row level security;
alter table public.rate_limit_hits enable row level security;
alter table public.audit_log enable row level security;

grant all on public.sync_runs, public.app_config, public.rate_limit_hits, public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;
