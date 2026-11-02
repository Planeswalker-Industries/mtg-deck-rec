-- Deck stats card types (T071).
--
-- * commander_stats gains type_profile: nonland cards per deck of each counted type ('creature', 'instant', 'sorcery',
--   'artifact', 'enchantment', 'planeswalker'; a card counts once, as the first its front face has), written with the
--   rest of a commander's stats, diff-only. Rows stay '{}' until the next full pass writes them.
-- * typical_deck_profile() returns the typical deck's types beside its curve, over the keys that have a type profile.
--   The app leaves the types out of Deck stats while that is empty.

alter table public.commander_stats
  add column if not exists type_profile jsonb not null default '{}'::jsonb;
comment on column public.commander_stats.type_profile is
  'Nonland cards per deck of each counted card type (''creature'' to ''planeswalker''), over the key''s decks (T071).';

-- Every counted deck belongs to exactly one commander key, so weighting each key's profile by its decks gives the
-- corpus's average. Curve and types are averaged over the keys that have each, so keys not yet given a type profile
-- don't pull the types toward 0. Computed on read (about 2,700 rows) and cached by the app: no table holds it.
create or replace function public.typical_deck_profile()
returns jsonb
language sql
stable
set search_path = public
as $$
  with profiles as (
    select 'curve' as kind, s.deck_count, s.curve_profile as profile
    from public.commander_stats s
    where s.curve_profile <> '{}'::jsonb and s.deck_count > 0
    union all
    select 'types', s.deck_count, s.type_profile
    from public.commander_stats s
    where s.type_profile <> '{}'::jsonb and s.deck_count > 0
  ), totals as (
    select kind, sum(deck_count)::numeric as decks from profiles group by kind
  ), entries as (
    select p.kind, e.key, sum(e.value::numeric * p.deck_count) as cards
    from profiles p cross join lateral jsonb_each_text(p.profile) e
    group by p.kind, e.key
  ), averaged as (
    select e.kind, jsonb_object_agg(e.key, round(e.cards / t.decks, 2)) as profile
    from entries e
    join totals t on t.kind = e.kind
    group by e.kind
  )
  select jsonb_build_object(
    'decks', coalesce((select t.decks from totals t where t.kind = 'curve'), 0),
    'curve', coalesce((select a.profile from averaged a where a.kind = 'curve'), '{}'::jsonb),
    'types', coalesce((select a.profile from averaged a where a.kind = 'types'), '{}'::jsonb)
  );
$$;

revoke all on function public.typical_deck_profile() from public;
grant execute on function public.typical_deck_profile() to anon, authenticated, service_role;
