-- The learned skeleton (T062; docs/roadmap/scoring-design.md, "`curve`" and "`role`").
--
-- * commander_stats gains curve_profile (nonland cards per deck at each mana value, '0' to '7', the last for 7 and
--   up), land_count and basic_land_count (per deck), written with the rest of a commander's stats, diff-only. Builds
--   (T063) read the land counts, so no fixed minimum of basics is needed.
-- * commander_sets gains EDHREC's role and curve profiles for the commander's page: the summed inclusion of the listed
--   cards in each role and at each mana value, scaled so the curve totals skeleton.typicalNonlandCards (pages are
--   trimmed: their sums run near 45 nonland cards where our decks hold 64). serving_commander_profile reads them.
-- * app_config.scoring: the `curve` component at weight 0 everywhere, and `skeleton` with every new piece off, until
--   the evaluation passes it.

alter table public.commander_stats
  add column if not exists curve_profile jsonb not null default '{}'::jsonb,
  add column if not exists land_count real,
  add column if not exists basic_land_count real;
comment on column public.commander_stats.curve_profile is
  'Nonland cards per deck at each mana value (''0'' to ''7'', the last for 7 and up), over the key''s decks (T062).';
comment on column public.commander_stats.land_count is 'Lands per deck, basics included (T062).';
comment on column public.commander_stats.basic_land_count is 'Basic lands per deck (T062).';

alter table public.commander_sets
  add column if not exists edhrec_role_profile jsonb,
  add column if not exists edhrec_curve_profile jsonb;
comment on column public.commander_sets.edhrec_role_profile is
  'Summed EDHREC inclusion of the listed cards in each tracked role: the prior for role targets (T062). Never displayed.';
comment on column public.commander_sets.edhrec_curve_profile is
  'Summed EDHREC inclusion of the listed nonland cards at each mana value: the prior for the curve (T062). Never displayed.';

update public.app_config
   set value = jsonb_set(
                 jsonb_set(
                   jsonb_set(value, '{weights,add,curve}', '0'::jsonb),
                   '{weights,swap,collection_less,curve}', '0'::jsonb),
                 '{weights,swap,collection_aware,curve}', '0'::jsonb)
               || '{"skeleton": {"edhrecPrior": false, "curveCuts": false, "curveOverloadRatio": 1.25, "typicalNonlandCards": 64}}'::jsonb,
       updated_at = now()
 where key = 'scoring'
   and not value ? 'skeleton';

-- EDHREC's profiles for exactly these commanders (any order), with the page's deck count: null without a page.
create or replace function public.serving_commander_profile(p_commander_ids integer[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  )
  select jsonb_build_object('roles', s.edhrec_role_profile, 'curve', s.edhrec_curve_profile, 'decks', s.edhrec_decks)
  from m
  join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
  where s.edhrec_decks is not null and cardinality(m.ids) between 1 and 2
$$;

revoke all on function public.serving_commander_profile(integer[]) from public;
grant execute on function public.serving_commander_profile(integer[]) to anon, authenticated, service_role;
