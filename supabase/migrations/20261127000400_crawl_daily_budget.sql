-- A failed run resumes the same day, within the day's budget (T107 task 6).
--
-- The crawl's allowance (app_config.<source>.runMinutes, six hours) is the day's total, not each run's. A run reads how
-- much of today (UTC) the source has already crawled and gets only what is left; past it, a run started for a deck
-- lookup visits only the requested commanders. The worker's schedule uses the same number to decide whether a run that
-- failed or was stopped may be followed by another (app_config.worker crawlResumeMinutes, crawlResumesPerDay).

-- Seconds the source has crawled today (UTC): each run that started today and held the claim counts from its start to
-- its end, or to now while it is open. A run that never held the claim ('already running') crawled nothing. A run
-- closed as abandoned (crawl_claim's takeover, crawl_close_stale_runs) was dead long before its finished_at, so it
-- counts to its last sign of life instead.
create or replace function public.crawl_used_today(p_source text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from greatest(
           case
             when r.finished_at is null then now()
             when r.error like 'abandoned%' then coalesce(r.progress_at, r.started_at)
             else r.finished_at
           end - r.started_at,
           interval '0')))::integer, 0)
    from crawl.runs r
   where r.source = p_source
     and r.started_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
     and r.error is distinct from 'already running';
$$;

-- Only the crawl's own role, as for the other crawl_* functions (20260922000300_deck_crawl_corpus.sql). The worker
-- connects as the database owner and calls it directly.
revoke all on function public.crawl_used_today(text) from public, anon, authenticated;
grant execute on function public.crawl_used_today(text) to service_role;

-- How the worker resumes a failed run: no sooner than this many minutes after it ended, and no more than this many
-- times a day, so a source failing at every start stops being retried. A value already set wins over the default.
update public.app_config
   set value = jsonb_build_object('crawlResumeMinutes', 10, 'crawlResumesPerDay', 3) || value,
       updated_at = now()
 where key = 'worker'
   and not (value ? 'crawlResumeMinutes' and value ? 'crawlResumesPerDay');
