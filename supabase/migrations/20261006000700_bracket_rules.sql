-- Bracket rules and combos (T060; docs/roadmap/scoring-design.md, "Bracket rules" and "Combos").
--
-- * app_config.brackets (public): the Tagger tags that mark mass land denial and extra turns (planeswalkers left out:
--   their land denial or extra turn is an ultimate), the bracket mass land denial is allowed from, the extra-turn cards
--   each lower bracket allows, and the combo results that mean an extra-turn loop. The owner's answers of 2026-10-05.
--   Game Changer limits stay in code (gameChangerLimit): they are WotC's published list, not a setting.
-- * app_config.scoring.combos (private): how "complete a combo" orders its entries by what the combo does.
-- * spellbook_combo_details: each collated combo's results and template pieces, written by precompute_combos beside
--   spellbook_combo_pieces, so the app reads the serving layer and never corpus.
-- * bracket_cards(): the cards the bracket rules watch, as one jsonb value (a few hundred ids), cached by the app.
-- * serving_deck_combos(): the deck's complete combos and, with p_near, the combos it is one named card short of, each
--   short one with its missing card whole (a serving_card), in one read.
--
-- Commander Spellbook is credited and linked wherever a combo shows (CLAUDE.md, "Combos").

insert into public.app_config (key, value, is_public)
values (
  'brackets',
  '{
    "massLandDenialTagIds": ["cd12a44c-1aee-4ece-b8ea-3eb118ef0230"],
    "extraTurnTagIds": ["03b17ebf-f5d3-4063-bfd4-1ae156a16a8f"],
    "massLandDenialFromBracket": 4,
    "maxExtraTurnCards": {"1": 0, "2": 2, "3": 2},
    "extraTurnLoopResults": ["Infinite turns", "Infinite turns after one turn cycle"],
    "extraTurnLoopFromBracket": 4
  }'::jsonb,
  true
)
on conflict (key) do nothing;

update public.app_config
   set value = value || '{
     "combos": {
       "resultClasses": [
         {"match": "^(Win the game|Each opponent loses the game|Target opponent loses the game)$", "weight": 1},
         {"match": "^Infinite ((colored|colorless|white|blue|black|red|green) )?mana$", "weight": 0.8},
         {"match": "^Infinite (combat )?damage$", "weight": 0.8},
         {"match": "^Infinite (turns|combat phases)", "weight": 0.8}
       ],
       "standaloneWeight": 0.5,
       "contextualWeight": 0.2,
       "maxSuggestions": 8
     }
   }'::jsonb,
       updated_at = now()
 where key = 'scoring'
   and not value ? 'combos';

-- === spellbook_combo_details ===

create table if not exists public.spellbook_combo_details (
  variant_id         text primary key,
  -- Spellbook's standalone results ("Win the game"), then the ones that matter in context.
  results            text[] not null default '{}',
  contextual_results text[] not null default '{}',
  -- Pieces Spellbook names by template ("a Legendary Elemental Creature"), which nothing here can check.
  template_names     text[] not null default '{}'
);

alter table public.spellbook_combo_details enable row level security;
revoke all on public.spellbook_combo_details from anon, authenticated;
grant all on public.spellbook_combo_details to service_role;

-- === bracket_cards ===

create or replace function public.bracket_cards()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select value from public.app_config where key = 'brackets'
  ),
  watched as (
    select 'massLandDenial'::text as kind, t::uuid as tag_id from cfg, jsonb_array_elements_text(cfg.value -> 'massLandDenialTagIds') as t
    union all
    select 'extraTurns', t::uuid from cfg, jsonb_array_elements_text(cfg.value -> 'extraTurnTagIds') as t
  ),
  tagged as (
    select distinct w.kind, ct.card_id
    from watched w
    join public.tag_closure tc on tc.ancestor_id = w.tag_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
    join public.cards c on c.id = ct.card_id
    where c.deleted_at is null
      and c.type_line not ilike '%Planeswalker%'
  )
  select jsonb_build_object(
    'massLandDenial', coalesce((select jsonb_agg(card_id order by card_id) from tagged where kind = 'massLandDenial'), '[]'::jsonb),
    'extraTurns', coalesce((select jsonb_agg(card_id order by card_id) from tagged where kind = 'extraTurns'), '[]'::jsonb)
  )
$$;

revoke all on function public.bracket_cards() from public;
grant execute on function public.bracket_cards() to anon, authenticated, service_role;

-- === serving_deck_combos ===

-- The combos a deck holds every named piece of (missing null), and with p_near those it is one named card short of
-- (missing: that card, `card` its serving_card for these commanders). A piece that must be the commander has to be
-- one of the deck's commanders. A missing card passes the deck's filters: live, legal, not a basic land, inside the
-- commanders' colours, not left out, and no Game Changer unless the bracket allows them. Bracket limits are the app's:
-- every combo comes back with its minimum bracket. Complete combos come first, then the shortest; p_limit keeps the
-- answer under PostgREST's row cap.
create or replace function public.serving_deck_combos(
  p_card_ids integer[],
  p_commander_ids integer[],
  p_exclude integer[] default '{}',
  p_allow_game_changers boolean default true,
  p_near boolean default true,
  p_limit integer default 600
)
returns table (
  variant_id text,
  pieces integer[],
  min_bracket smallint,
  results text[],
  contextual_results text[],
  template_names text[],
  missing integer,
  card public.serving_card
)
language sql
stable
security definer
set search_path = ''
as $$
  with deck as materialized (
    select coalesce(array_agg(distinct x), '{}'::integer[]) as ids
    from unnest(coalesce(p_card_ids, '{}'::integer[]) || coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  commanders as materialized (
    select coalesce(array_agg(distinct x), '{}'::integer[]) as ids from unnest(coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  colours as (
    select coalesce(bit_or(c.color_identity), 0)::smallint as mask
    from public.cards c, commanders m
    where c.id = any (m.ids) and c.deleted_at is null
  ),
  hits as materialized (
    select p.variant_id, p.pieces, p.commander_pieces, p.min_bracket, count(*)::integer as held
    from public.spellbook_combo_pieces p, deck d
    where p.card_id = any (d.ids)
    group by p.variant_id, p.pieces, p.commander_pieces, p.min_bracket
    having count(*) >= cardinality(p.pieces) - case when p_near then 1 else 0 end
  ),
  combos as materialized (
    select h.variant_id, h.pieces, h.min_bracket,
           case when h.held < cardinality(h.pieces)
                then (select m from unnest(h.pieces) as m, deck d where m <> all (d.ids) limit 1)
           end as missing
    from hits h, commanders cm
    where h.commander_pieces <@ cm.ids
  ),
  picked as materialized (
    select c.variant_id, c.pieces, c.min_bracket, c.missing
    from combos c
    cross join colours
    left join public.cards card on card.id = c.missing
    where c.missing is null
       or (card.deleted_at is null
           and card.legal_commander = 'legal'
           and not card.is_basic_land
           and (card.color_identity & ~colours.mask) = 0
           and card.id <> all (coalesce(p_exclude, '{}'::integer[]))
           and (p_allow_game_changers or not card.game_changer))
    order by c.missing is not null, cardinality(c.pieces), c.variant_id
    limit p_limit
  )
  select p.variant_id, p.pieces, p.min_bracket, d.results, d.contextual_results, d.template_names, p.missing, r
  from picked p
  join public.spellbook_combo_details d on d.variant_id = p.variant_id
  left join public.serving_cards(p_commander_ids, array(select distinct missing from picked where missing is not null)) r
    on r.card_id = p.missing
  order by p.missing is not null, cardinality(p.pieces), p.variant_id
$$;

revoke all on function public.serving_deck_combos(integer[], integer[], integer[], boolean, boolean, integer) from public;
grant execute on function public.serving_deck_combos(integer[], integer[], integer[], boolean, boolean, integer)
  to anon, authenticated, service_role;
