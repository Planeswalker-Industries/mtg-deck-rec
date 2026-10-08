-- Deck stats (T045): the typical deck's curve, for commanders with too few decks of their own. Every counted deck
-- belongs to exactly one commander key, so weighting each key's profile by its decks gives the corpus's average.
-- Computed on read (about 2,700 rows) and cached by the app: no table holds it.
create or replace function public.typical_deck_profile()
returns jsonb
language sql
stable
set search_path = public
as $$
  with keyed as (
    select s.deck_count, s.curve_profile
    from public.commander_stats s
    where s.curve_profile <> '{}'::jsonb and s.deck_count > 0
  ), total as (
    select coalesce(sum(deck_count), 0)::numeric as decks from keyed
  ), buckets as (
    select e.key as bucket, sum(e.value::numeric * k.deck_count) as cards
    from keyed k cross join lateral jsonb_each_text(k.curve_profile) e
    group by e.key
  )
  select jsonb_build_object(
    'decks', t.decks,
    'curve', coalesce((select jsonb_object_agg(b.bucket, round(b.cards / t.decks, 2)) from buckets b where t.decks > 0), '{}'::jsonb)
  )
  from total t;
$$;

revoke all on function public.typical_deck_profile() from public;
grant execute on function public.typical_deck_profile() to anon, authenticated, service_role;
