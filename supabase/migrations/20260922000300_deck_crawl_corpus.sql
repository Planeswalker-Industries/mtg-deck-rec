-- Scraped commander decks (Moxfield, Archidekt) and their crawl bookkeeping.
--
-- The Go API on the VPS (services/search-api) scrapes each source on a daily trigger from the web app and writes
-- decklists here. Moxfield is built but blocked (Cloudflare WAF, 2026-09-22); Archidekt is active. This schema is
-- private on purpose: third-party decklists never reach the API roles (same stance as the card-graph plan's `corpus`
-- schema), and no app read path touches it yet. Aggregating these decks into the popularity metrics is the follow-up
-- milestone, which is why the rows live at oracle level (commanders + cards as oracle ids with quantities) with
-- change detection by content hash.
--
-- How the Go service reaches it: through the `public.crawl_*` security-definer functions at the bottom of this file,
-- never through PostgREST table access. PostgREST can only address schemas on its exposed list, and putting `corpus`
-- on that list is exactly what this schema exists to avoid — the functions keep the tables unreachable by `anon` and
-- `authenticated` while giving the crawl the handful of operations it actually needs.

create schema if not exists corpus;

-- The service role reaches the tables directly (psql, a future worker job). Granting table privileges without this
-- is a no-op: without USAGE on the schema every one of them is "permission denied for schema corpus".
grant usage on schema corpus to service_role;

-- A scraped deck, oracle-level. resolveDeck / identity / legality filtering are the aggregation milestone's job (the
-- worker owns those pure functions); this table is the raw scrape result, qualified as a Commander deck by the source
-- adapter (format, public, 100 cards) the same way the worker's qualifyDeck does.
create table corpus.decks (
  id bigint generated always as identity primary key,
  source text not null check (source in ('moxfield', 'archidekt')),
  source_deck_id text not null,           -- Moxfield slug, or Archidekt numeric deck id
  commanders text[] not null,             -- oracle ids, sorted (one or a partner pair)
  -- The rest of the 100, as {oracle id: quantity}. Quantities are kept, not collapsed: a deck's basics are most of
  -- what distinguishes its mana base, and deck_size cannot be re-derived from a set of distinct cards. jsonb rather
  -- than parallel arrays so the pairing cannot drift, and jsonb normalises key order so equal decks compare equal.
  cards jsonb not null,
  deck_size int not null,                 -- total copies including the commander(s); 100 for a legal Commander deck
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
  skipped_unqualified int not null default 0,  -- listed but not a public 100-card Commander deck
  blocks int not null default 0,
  error text
);

-- One row per source: the crawl cursor, the single-flight claim, and the kill switch. Re-enabling a blocked source
-- is a manual update on its row.
--
-- There is no next_page: every run restarts at page 1 because the feed is update-ordered and the caught-up rule ends
-- the walk. A stored page number would only be a cursor into a feed that has since moved.
create table corpus.crawl_state (
  source text primary key check (source in ('moxfield', 'archidekt')),
  last_deck_id text,              -- the newest deck the feed offered on the last run, for "how far did it get"
  running_run_id bigint,          -- single-flight: one crawl at a time
  client_id text,                 -- the container that claimed it, so a stale claim can be attributed
  claimed_at timestamptz,         -- when the claim was taken; a claim older than the stale window can be taken over
  disabled boolean not null default false,
  disabled_reason text,
  disabled_at timestamptz,
  probe_ok_at timestamptz         -- when the connectivity probe last passed
);

insert into corpus.crawl_state (source) values ('archidekt');

-- Moxfield starts switched off, not merely expected to switch itself off. It answered Cloudflare's hard WAF block to
-- the app's honest User-Agent on a robots.txt-allowed path (2026-09-22), so the correct number of requests to make
-- to it is zero; letting the first daily run discover that again would be one request whose only purpose is to be
-- refused. A human clears `disabled` when Moxfield grants an accessible path.
insert into corpus.crawl_state (source, disabled, disabled_reason, disabled_at)
values ('moxfield', true, 'Cloudflare WAF block on an allowed path, probed 2026-09-22', now());

alter table corpus.decks enable row level security;
alter table corpus.crawl_runs enable row level security;
alter table corpus.crawl_state enable row level security;

-- Writes come only from the Go API, through the functions below. No anon or authenticated grants anywhere: the
-- groomed aggregates already live in `public`, and third-party decklists never do.
grant select, insert, update, delete on all tables in schema corpus to service_role;
alter default privileges in schema corpus grant select, insert, update, delete on tables to service_role;

-- Crawl policy. Anti-abuse thresholds belong in app_config (the repo is public), and the Go
-- crawlers read their row at run start (key = source name). requestIntervalMs is the polite
-- pace; maxDecksPerRun bounds a single crawl; backfillDecks is the budget for the first-ever
-- run; backoffStartMs/maxMs shape the retry pause on 429/5xx; staleClaimSeconds is how long a
-- claim may sit untouched before another run may take it over. There is deliberately no "how
-- many blocks" knob: a single 403 or challenge is a definitive block and flips that source off
-- until re-enabled by hand.
--
-- Moxfield: built, blocked; a 1000 ms pace is the polite default it would use if access is ever
-- granted. Archidekt: active; one request a second drew 429s on 2026-09-14 (worker evidence), so
-- the default pace is 3000 ms.
insert into public.app_config (key, value, is_public)
values
  ('moxfield', '{"requestIntervalMs": 1000, "maxDecksPerRun": 500, "backfillDecks": 10000, "backoffStartMs": 5000, "backoffMaxMs": 300000, "staleClaimSeconds": 21600}'::jsonb, false),
  ('archidekt', '{"requestIntervalMs": 3000, "maxDecksPerRun": 1000, "backfillDecks": 10000, "backoffStartMs": 5000, "backoffMaxMs": 300000, "staleClaimSeconds": 21600}'::jsonb, false)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------------------------------------------
-- The crawl's API surface.
--
-- These live in `public` because that is the only schema PostgREST exposes, and they are security definer because
-- `corpus` is deliberately not reachable any other way. Execute is revoked from `public` and granted to
-- `service_role` alone, so the only caller that can reach them is the one holding the service key: the Go crawl on
-- the VPS. Every one of them is keyed by source, so a caller can never operate on a source it did not name.
-- ---------------------------------------------------------------------------------------------------------------

-- The source's live state plus the deck count the budget needs (backfill on an empty corpus, daily increment after).
-- Upserts the row so a source added later cannot silently no-op against a missing one.
create or replace function public.crawl_state(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row corpus.crawl_state;
begin
  insert into corpus.crawl_state (source) values (p_source) on conflict (source) do nothing;
  select * into v_row from corpus.crawl_state where source = p_source;
  return jsonb_build_object(
    'disabled', v_row.disabled,
    'disabledReason', coalesce(v_row.disabled_reason, ''),
    'runningRunId', coalesce(v_row.running_run_id, 0),
    'clientId', coalesce(v_row.client_id, ''),
    'claimedAt', v_row.claimed_at,
    'lastDeckId', coalesce(v_row.last_deck_id, ''),
    'probeOk', v_row.probe_ok_at is not null,
    'deckCount', (select count(*) from corpus.decks where source = p_source)
  );
end;
$$;

-- Opens a run row. The claim below points at it, so it exists before anything is crawled.
create or replace function public.crawl_create_run(p_source text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into corpus.crawl_runs (source, state) values (p_source, 'queued') returning id;
$$;

-- The single-flight mutex. `select ... for update` serialises concurrent claimants on the source's own row, so two
-- crons firing together cannot both crawl — the loser sees the winner's run id and backs off.
--
-- A claim older than p_stale_after_seconds may be taken over: a container killed mid-crawl (a deploy, an OOM) can
-- never release its claim, and without a takeover the source would be wedged until someone ran SQL by hand. The
-- superseded run is closed as failed so the run log says what happened to it rather than leaving it 'running'.
create or replace function public.crawl_claim(
  p_source text,
  p_run_id bigint,
  p_client_id text,
  p_stale_after_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_run bigint;
  v_claimed_at timestamptz;
begin
  select running_run_id, claimed_at into v_prior_run, v_claimed_at
    from corpus.crawl_state where source = p_source for update;
  if not found then
    return jsonb_build_object('claimed', false, 'tookOver', false, 'heldBy', 0);
  end if;
  if v_prior_run is not null
     and v_claimed_at is not null
     and v_claimed_at > now() - make_interval(secs => greatest(p_stale_after_seconds, 0)) then
    return jsonb_build_object('claimed', false, 'tookOver', false, 'heldBy', v_prior_run);
  end if;

  update corpus.crawl_state
     set running_run_id = p_run_id, client_id = p_client_id, claimed_at = now()
   where source = p_source;

  if v_prior_run is not null then
    update corpus.crawl_runs
       set state = 'failed',
           finished_at = coalesce(finished_at, now()),
           error = coalesce(nullif(error, ''), 'abandoned: the claim went stale and was taken over')
     where id = v_prior_run and state in ('queued', 'running');
  end if;
  return jsonb_build_object('claimed', true, 'tookOver', v_prior_run is not null, 'heldBy', p_run_id);
end;
$$;

-- Releases only a claim this run still holds: a run whose claim was taken over as stale must not clear the claim of
-- whoever took it.
create or replace function public.crawl_release(p_source text, p_run_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released boolean := false;
begin
  update corpus.crawl_state
     set running_run_id = null, client_id = null, claimed_at = null
   where source = p_source and running_run_id = p_run_id;
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

-- Closes a run with what it saw and did. finished_at is set here and nowhere else, so an unfinished row is exactly
-- a run that never got to report.
create or replace function public.crawl_finish_run(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_runs set
    state = case when p_summary->>'state' in ('queued', 'running', 'succeeded', 'failed')
                 then p_summary->>'state' else 'failed' end,
    finished_at = now(),
    pages_seen = coalesce((p_summary->>'pages_seen')::int, 0),
    decks_listed = coalesce((p_summary->>'decks_listed')::int, 0),
    decks_fetched = coalesce((p_summary->>'decks_fetched')::int, 0),
    decks_written = coalesce((p_summary->>'decks_written')::int, 0),
    skipped_unchanged = coalesce((p_summary->>'skipped_unchanged')::int, 0),
    skipped_unqualified = coalesce((p_summary->>'skipped_unqualified')::int, 0),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;

-- The content hashes of the decks we already hold, for just the ids a feed page listed. Per page rather than per
-- run: the whole corpus is the one thing that grows without bound, and a daily run only ever needs to know about
-- the few hundred decks in front of it.
create or replace function public.crawl_deck_hashes(p_source text, p_ids text[])
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(source_deck_id, content_hash), '{}'::jsonb)
    from corpus.decks
   where source = p_source and source_deck_id = any(p_ids);
$$;

-- Writes scraped decks. Diff-only, like every other write in this project: a row whose content hash is unchanged is
-- left alone rather than rewritten, so an unchanged deck costs no dead row version. Returns how many rows actually
-- changed.
create or replace function public.crawl_upsert_decks(p_source text, p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_written int;
begin
  with incoming as (
    select
      p_source as source,
      row_value->>'source_deck_id' as source_deck_id,
      array(select jsonb_array_elements_text(row_value->'commanders')) as commanders,
      row_value->'cards' as cards,
      (row_value->>'deck_size')::int as deck_size,
      row_value->>'content_hash' as content_hash,
      (row_value->>'listed_updated_at')::timestamptz as listed_updated_at,
      (row_value->>'last_updated_at')::timestamptz as last_updated_at
    from jsonb_array_elements(p_rows) as row_value
  )
  insert into corpus.decks as d
    (source, source_deck_id, commanders, cards, deck_size, content_hash, listed_updated_at, last_updated_at)
  select source, source_deck_id, commanders, cards, deck_size, content_hash, listed_updated_at, last_updated_at
    from incoming
  on conflict (source, source_deck_id) do update set
    commanders = excluded.commanders,
    cards = excluded.cards,
    deck_size = excluded.deck_size,
    content_hash = excluded.content_hash,
    listed_updated_at = excluded.listed_updated_at,
    last_updated_at = excluded.last_updated_at,
    fetched_at = now()
  where d.content_hash is distinct from excluded.content_hash;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- Records how far the feed got, and that an honest fetch of an allowed path still works.
create or replace function public.crawl_set_cursor(p_source text, p_last_deck_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_state set last_deck_id = nullif(p_last_deck_id, '') where source = p_source;
$$;

create or replace function public.crawl_probe_ok(p_source text)
returns void
language sql
security definer
set search_path = ''
as $$
  update corpus.crawl_state set probe_ok_at = now() where source = p_source;
$$;

-- The kill switch. Audited, because a source switching itself off silently is a data pipeline that has quietly
-- stopped: `select * from public.audit_log where action = 'crawl.disabled'` is how anyone finds out.
create or replace function public.crawl_disable(p_source text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update corpus.crawl_state
     set disabled = true, disabled_reason = p_reason, disabled_at = now()
   where source = p_source and not disabled;
  if found then
    insert into public.audit_log (action, payload)
    values ('crawl.disabled', jsonb_build_object('source', p_source, 'reason', p_reason));
  end if;
end;
$$;

-- Only the service key. Execute is granted to PUBLIC by default, which would put the private corpus behind an
-- `anon` RPC call, so every one of these is revoked first.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.crawl_state(text)',
    'public.crawl_create_run(text)',
    'public.crawl_claim(text, bigint, text, int)',
    'public.crawl_release(text, bigint)',
    'public.crawl_finish_run(bigint, jsonb)',
    'public.crawl_deck_hashes(text, text[])',
    'public.crawl_upsert_decks(text, jsonb)',
    'public.crawl_set_cursor(text, text)',
    'public.crawl_probe_ok(text)',
    'public.crawl_disable(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
