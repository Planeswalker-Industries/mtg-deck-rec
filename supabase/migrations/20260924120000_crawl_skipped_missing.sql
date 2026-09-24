-- A deck that vanished between the feed listing it and the crawl fetching it.
--
-- The browse feed is update-ordered and the crawl walks it at one request a second, so minutes pass between a deck
-- being listed and being fetched. In that window it can be deleted, made private, or have its id retired, and the
-- source answers 404. That is ordinary at this rate, not exceptional — but the run loop had only three outcomes for a
-- deck error (a block ends the run, a NotQualified is skipped, anything else fails the run), so one missing deck
-- aborted a whole crawl. Observed 2026-09-24: a run died on deck 26724957 after about a hundred decks, and would
-- have died on the same id every night for as long as the feed kept listing it.
--
-- Counted apart from skipped_unqualified because the two mean different things to whoever reads the table: a rising
-- skipped_unqualified says the browse filters admit decks the corpus does not want, while a rising skipped_missing
-- says the feed is stale or the crawl is falling behind deletions. Conflating them would hide both.
alter table corpus.crawl_runs
  add column if not exists skipped_missing integer not null default 0;

comment on column corpus.crawl_runs.skipped_missing is
  'Decks the feed listed that answered 404/410 when fetched: deleted, made private, or retired since listing.';

-- Unchanged but for the new line: the summary travels as jsonb, so the signature and its grants stay as they were.
-- `set search_path` is repeated because create or replace drops it.
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
    skipped_missing = coalesce((p_summary->>'skipped_missing')::int, 0),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;
