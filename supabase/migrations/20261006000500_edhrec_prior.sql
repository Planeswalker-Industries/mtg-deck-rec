-- The EDHREC prior by sample size (T061; docs/roadmap/scoring-design.md, "`corpus`"). A commander's inclusion of a card is
-- shrunk toward EDHREC's rate for it when the commander's page lists it, with the strength of the page's potential
-- decks for the card, or toward min(p0, the page's lowest listed rate) when it doesn't, with the strength of the page's
-- decks; both capped at app_config.corpus.edhrecPriorCap, so our own decks take over as they grow. Without a page the
-- shrink stays the colour baseline at shrinkAlpha. The commander's evidence (what its share of the corpus score rests
-- on) is its own decks plus that strength. It replaces externalPriorShare and edhrec_card_priors.
--
-- The precompute worker scores every commander set with a page too, including commanders we hold no decks for, and
-- stores per card what the request needs to redo the arithmetic: the page's rate and potential decks for a listed
-- card (commander_card_scores), and the page's floor and deck count for the set (commander_sets). EDHREC's numbers are
-- never displayed: the evidence shown stays our own counts.

alter table public.commander_card_scores
  add column if not exists prior_rate real,
  add column if not exists prior_decks integer;
comment on column public.commander_card_scores.prior_rate is
  'The commander''s EDHREC page''s inclusion for the card, when the page lists it (T061). Never displayed.';
comment on column public.commander_card_scores.prior_decks is
  'The page''s potential decks for the card: the prior''s strength before the cap. Never displayed.';

alter table public.commander_sets
  add column if not exists edhrec_floor real,
  add column if not exists edhrec_decks integer;
comment on column public.commander_sets.edhrec_floor is 'The lowest inclusion the commander''s EDHREC page lists (T061).';
comment on column public.commander_sets.edhrec_decks is 'The decks the commander''s EDHREC page describes (T061).';

alter type public.serving_card
  add attribute prior_rate real,
  add attribute prior_decks integer,
  add attribute edhrec_floor real,
  add attribute edhrec_decks integer;

-- edhrecPriorCap 100, set by the offline evaluation (2026-10-06, time split: the 5,200 decks updated after the EDHREC
-- snapshot held out): adds recall@20 17.2% -> 25.1% (+8.0 points, 95% interval +7.3 to +8.7), commanders under 10
-- decks 6.0% -> 19.7%, 10-49 decks 7.6% -> 26.0%, 50+ 24.0% -> 26.0%, cuts precision@10 19.4% -> 25.2%, collection
-- recall 34.0% -> 50.2%, Sol Ring rate 21.8% -> 8.8%. Caps of 50, 200, 400 and 1000 gave the same recall within
-- 0.1 point; cut precision fell as the cap rose (25.8% at 50, 23.2% at 1000). externalPriorShare goes.
update public.app_config
   set value = (value - 'externalPriorShare') || '{"edhrecPriorCap": 100}'::jsonb, updated_at = now()
 where key = 'corpus'
   and (value ? 'externalPriorShare' or (value -> 'edhrecPriorCap') is distinct from '100'::jsonb);

drop function if exists public.edhrec_card_priors(integer[], integer[]);

-- serving_cards, with the prior's numbers for each card and the set's page.
create or replace function public.serving_cards(p_commander_ids integer[], p_card_ids integer[])
returns setof public.serving_card
language sql
stable
security definer
set search_path = ''
set enable_nestloop = on
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  target_set as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           s.commander_1 is not null as known,
           s.edhrec_floor,
           s.edhrec_decks
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
  )
  select c.id,
         c.oracle_id, c.name, c.slug, c.mana_value, c.mana_cost, c.type_line, c.color_identity, c.images, c.game_changer,
         c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of, c.legal_commander,
         c.can_be_commander, c.partner_kind, c.partner_qualifier, c.copy_limit, c.is_basic_land, c.artist, c.keywords,
         to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM'),
         g.rate, g.decks_with, g.eligible_decks,
         s.decks_with, s.commander_decks,
         p.decks_with, p.too_early,
         coalesce(r.role_ids, '{}'::uuid[]),
         s.prior_rate, s.prior_decks, t.edhrec_floor, t.edhrec_decks
  from (select distinct unnest(p_card_ids) as id) ids
  join public.cards c on c.id = ids.id and c.deleted_at is null
  cross join target_set t
  left join public.card_stats st on st.card_id = c.id
  left join public.card_global_stats g on g.card_id = c.id
  left join public.commander_card_scores s
    on t.known and s.commander_1 = t.c1 and s.commander_2 = t.c2 and s.card_id = c.id
  left join lateral (
    select sum(pt.decks_with)::integer as decks_with, sum(pt.too_early)::integer as too_early
    from public.partner_card_totals pt
    where not t.known and t.n = 2 and pt.commander_id in (t.c1, t.c2) and pt.card_id = c.id
  ) p on true
  left join lateral (
    select array_agg(cr.role_id order by cr.role_id) as role_ids from public.card_roles cr where cr.card_id = c.id
  ) r on true
$$;
