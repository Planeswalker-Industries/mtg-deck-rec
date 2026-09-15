-- Sync jobs rewrote whole tables on every run: every card_tags, tag_edges and tag_closure row for a two-tag change,
-- all of card_stats and card_names, and the price columns of ~34k cards. Each rewritten row leaves a dead version, and
-- on the 500 MB hosted tier card_tags doubled (33 → 65 MB) in one run. The jobs now write only rows that change.

-- Tag closure: computed in full, but only pairs that appear, disappear or change depth are written.
create or replace function public.rebuild_tag_closure()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  drop table if exists pg_temp.next_tag_closure;
  create temp table next_tag_closure on commit drop as
  with recursive walk (ancestor_id, descendant_id, depth) as (
    select t.id, t.id, 0
    from public.tags t
    where t.deleted_at is null
    union all
    select w.ancestor_id, e.child_id, w.depth + 1
    from walk w
    join public.tag_edges e on e.parent_id = w.descendant_id
    where w.depth < 12
  ) cycle descendant_id set is_cycle using path
  select ancestor_id, descendant_id, min(depth)::smallint as depth
  from walk
  where not is_cycle
  group by ancestor_id, descendant_id;

  delete from public.tag_closure tc
  where not exists (
    select 1 from pg_temp.next_tag_closure n where n.ancestor_id = tc.ancestor_id and n.descendant_id = tc.descendant_id
  );

  insert into public.tag_closure as tc (ancestor_id, descendant_id, depth)
  select ancestor_id, descendant_id, depth from pg_temp.next_tag_closure
  on conflict (ancestor_id, descendant_id) do update set depth = excluded.depth
  where tc.depth is distinct from excluded.depth;
end;
$$;

-- When prices were last checked against Scryfall: the newest successful catalog or printings sync. cards.prices_as_of now
-- moves only when a card's price changes, so the app shows this as the prices' as-of date.
create function public.prices_checked_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(source_updated_at)
  from public.sync_runs
  where status = 'succeeded' and job in ('scryfall_catalog', 'scryfall_printings')
$$;

revoke execute on function public.prices_checked_at() from public;
grant execute on function public.prices_checked_at() to anon, authenticated, service_role;
