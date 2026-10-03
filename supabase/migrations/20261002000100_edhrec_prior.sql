-- The EDHREC prior, readable by the app without exposing the table it comes from.
--
-- `external_commanders` and `external_commander_card_stats` are revoked from `anon` and `authenticated` on purpose
-- (20260928000200): they are a third party's aggregates, and card-graph-plan's slice 11 says their numbers inform
-- scoring and are never displayed. That stays true. This is a security-definer function in `public` that answers the
-- one question scoring asks - "what does EDHREC say these cards' inclusion is under exactly these commanders?" - the
-- same pattern as `card_functional_tags` standing in front of the `functional_tags` view.
--
-- Why it is needed at all: `spike:edhrec:prior` measured that for a commander with no decks of our own, EDHREC's top
-- 50 matched the hidden answer 80% of the time against 6% for the colour baseline the app falls back to today.
--
-- Returns one jsonb object, card id to inclusion, so PostgREST's row cap never truncates it - the same reason
-- `sitemap_slugs` and `my_collection_entries` return single values.

create or replace function public.external_card_priors(
  p_commander_ids integer[],
  p_card_ids integer[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Exactly these commanders, never a borrowed pairing: EDHREC publishes a page per commander or pair, and a
  -- partner's solo page describes different decks. Borrowing is what pickCorpusSources does with *our* decks.
  --
  -- The commanders arrive as an array rather than two arguments so the "one commander" case needs no null argument,
  -- and are normalised here the way external_commanders stores them (lower card id first, null for a single).
  with want as (
    select (select min(id) from unnest(p_commander_ids) id) as c1,
           (select case when count(distinct id) > 1 then max(id) end from unnest(p_commander_ids) id) as c2,
           (select count(distinct id) from unnest(p_commander_ids) id) as n
  )
  select coalesce(jsonb_object_agg(s.card_id, s.decks_with::real / s.potential_decks), '{}'::jsonb)
    from want w
    join public.external_commanders e
      on e.source = 'edhrec' and e.commander_1 = w.c1 and e.commander_2 is not distinct from w.c2
    join public.external_commander_card_stats s on s.external_commander_id = e.id
   where w.n between 1 and 2
     and s.card_id = any(p_card_ids);
$$;

-- Readable by the app's own roles, because the function returns only the numbers and never the pages behind them.
-- Execute is granted to PUBLIC by default, which would also hand it to an unauthenticated caller, so revoke first.
revoke all on function public.external_card_priors(integer[], integer[]) from public;
grant execute on function public.external_card_priors(integer[], integer[]) to anon, authenticated, service_role;

-- The knob, off. The code path exists but changes no score until this is set, so the migration and the deploy are
-- safe on their own and turning the prior on is a one-row config change that can be reverted the same way.
--
-- What to set it to: `spike:edhrec:prior` reports the top-50 overlap for the colour and EDHREC priors at 0, 5, 10, 20,
-- 30 and 50 decks of our own (X:\mtg_proj\reports\edhrec-prior-<date>.md). The share should be about where our own
-- decks stop losing to EDHREC - read it off that curve rather than guessing.
update public.app_config
   set value = value || '{"externalPriorShare": 0}'::jsonb, updated_at = now()
 where key = 'corpus';
