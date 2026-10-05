-- Everything that used to run from one PC now runs on the VPS or reads from Supabase:
--
-- * The worker container on the VPS (deploy/worker/) serves deck lookups, rebuilds the corpus stats from
--   corpus.decks, refreshes EDHREC's commander pages and triggers the daily crawl, on the schedule below.
-- * A commander someone asked for jumps the crawl queue, so the daily crawl collects its decks even before the
--   worker gets the source's claim.
-- * The recommendation regression fixtures live in a private table instead of files.

-- === the worker's schedule ===

insert into public.app_config (key, value) values (
  'worker',
  jsonb_build_object(
    -- Rebuild the corpus stats when corpus.decks changed and the last successful rebuild is at least this old.
    'aggregateEveryHours', 6,
    -- Refetch every EDHREC commander page this often (about 8,100 pages at one per 1.5 s: three and a half hours).
    'edhrecEveryDays', 7,
    -- Spacing between EDHREC requests: a static bucket behind CloudFront, asked politely.
    'edhrecRequestIntervalMs', 1500,
    -- Start each source's daily crawl at or after this hour (UTC) if it has not started one today.
    'crawlHourUtc', 10,
    'crawlSources', jsonb_build_array('archidekt'),
    -- How often the worker checks the request queue and its schedule.
    'pollSeconds', 5
  )
)
on conflict (key) do nothing;

-- === request runs ===

-- The worker serves a deck lookup under the same claim as the crawl, so the two never press Archidekt at once; it
-- records that work as a crawl run too. `kind` tells the two apart, so a served request is not mistaken for the day's
-- crawl having started.
alter table corpus.crawl_runs add column if not exists kind text not null default 'crawl' check (kind in ('crawl', 'request'));

-- === requested commanders first ===

-- As before, but a commander with an active deck request comes first: the worker collects requested decks itself when
-- it holds the claim, and while the daily crawl holds it instead, the crawl serves those commanders before any other.
-- A requested commander the seed list does not know is added to the queue so the crawl can reach it at all.
create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target int := coalesce((select (value->>'targetDecks')::int from public.app_config where key = p_source), 60);
begin
  insert into corpus.crawl_commanders (source, commander_card_id, seed_decks, held_decks)
  select p_source, r.commander_card_id, 0, 0
    from public.commander_requests r
   where r.status in ('queued', 'checking', 'collecting')
  on conflict (source, commander_card_id) do nothing;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cardId', q.commander_card_id,
             'oracleId', k.oracle_id,
             'name', k.name,
             'queryName', coalesce(q.query_name, ''),
             'heldDecks', q.held_decks,
             'visited', q.last_visited_at is not null
           ) order by q.requested desc, q.ord, q.seed_decks desc, q.last_visited_at nulls first, q.commander_card_id),
           '[]'::jsonb)
      from (
        select t.commander_card_id, t.query_name, t.last_visited_at, t.seed_decks, t.held_decks,
               exists (
                 select 1 from public.commander_requests r
                  where r.commander_card_id = t.commander_card_id
                    and r.status in ('queued', 'checking', 'collecting')
               ) as requested,
               -- Under the target first. Within each group the old order stands: never visited, most played, stalest.
               (t.held_decks >= v_target)::int * 2 + (t.last_visited_at is not null)::int as ord
          from corpus.crawl_commanders t
         where t.source = p_source
           and t.outcome is distinct from 'not_found'
           and t.last_run_id is distinct from p_run_id
         order by 6 desc, (t.held_decks >= v_target), (t.last_visited_at is not null),
                  t.seed_decks desc, t.last_visited_at nulls first, t.commander_card_id
         limit p_limit
      ) q
      join public.cards k on k.id = q.commander_card_id
  );
end;
$$;

-- === regression fixtures ===

-- The recommendation regression fixtures (`yarn workspace @mtg/web regress`): real decklists with the cuts, adds and
-- swaps they must or must not produce. Private because the decklists are not ours to publish; read and written with
-- the service role only.
create table public.regression_fixtures (
  name text primary key check (length(name) between 1 and 200),
  fixture jsonb not null check (jsonb_typeof(fixture) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.regression_fixtures enable row level security;
revoke all on public.regression_fixtures from anon, authenticated;
grant all on public.regression_fixtures to service_role;
