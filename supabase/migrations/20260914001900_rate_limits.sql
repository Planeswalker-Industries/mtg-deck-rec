-- Per-visitor request budgets for the public endpoints: recommendations, deck parsing and analysis, Archidekt link
-- imports (each one calls Archidekt), and commander deck lookups. Budgets live in app_config.rate_limits as
-- {bucket: {limit, windowSeconds}}; a bucket without an entry isn't limited. Counts use fixed windows in the existing
-- unlogged rate_limit_hits table.

insert into public.app_config (key, value, is_public)
values (
  'rate_limits',
  '{"recs": {"limit": 90, "windowSeconds": 60}, "deck": {"limit": 30, "windowSeconds": 60}, "import": {"limit": 10, "windowSeconds": 60}, "lookup": {"limit": 90, "windowSeconds": 60}}'::jsonb,
  false
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Counts one request for a visitor (a salted hash the app computes) and returns 0 when it's within budget, otherwise
-- the seconds until the window resets. Callers can only raise their own counters: visitor keys can't be derived
-- without the app's salt.
create function public.hit_rate_limit(p_bucket text, p_visitor text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule jsonb := (select value -> p_bucket from public.app_config where key = 'rate_limits');
  max_hits integer := (rule ->> 'limit')::int;
  window_seconds integer := greatest(coalesce((rule ->> 'windowSeconds')::int, 60), 1);
  current_window timestamptz;
  hit_count integer;
begin
  if max_hits is null or p_visitor is null then
    return 0;
  end if;
  current_window := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  insert into public.rate_limit_hits as h (key, window_start, hits)
  values (p_bucket || ':' || p_visitor, current_window, 1)
  on conflict (key, window_start) do update set hits = h.hits + 1
  returning h.hits into hit_count;

  -- Finished windows are never read again; clear them out now and then.
  if random() < 0.01 then
    delete from public.rate_limit_hits h where h.window_start < now() - interval '1 hour';
  end if;

  if hit_count <= max_hits then
    return 0;
  end if;
  return greatest(ceil(extract(epoch from (current_window + make_interval(secs => window_seconds) - now())))::int, 1);
end;
$$;

revoke execute on function public.hit_rate_limit(text, text) from public;
grant execute on function public.hit_rate_limit(text, text) to anon, authenticated, service_role;
