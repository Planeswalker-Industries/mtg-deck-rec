-- Combos from Commander Spellbook, loaded daily by `sync:combos` from its published export
-- (json.commanderspellbook.com/variants.json.gz). Each row is one exact set of cards that makes a combo ("variant" in
-- Spellbook's terms), keyed by our card ids. Card-to-card relationships that hold whatever the commander, where the
-- deck corpus only says what decks happen to run: the input for combo detection in the bracket estimate (T047) and for
-- recommending the missing piece of a combo a deck nearly has. Nothing reads them yet.

-- What a combo produces ("Infinite colored mana", "Win the game"). Keyed by Spellbook's own feature id.
create table public.combo_features (
  id integer primary key,
  name text not null,
  -- S: a standalone result. C: a result that matters in context. H: a hidden step Spellbook uses to chain combos
  -- ("Infinite creature ETB"), which it never shows as a result.
  status text not null check (status in ('S', 'C', 'H'))
);

create table public.combos (
  id integer generated always as identity primary key,
  -- Spellbook's variant id, e.g. '2645-5640-7935'; its page is commanderspellbook.com/combo/<id>/.
  spellbook_id text not null unique,
  -- The named pieces, ascending and distinct. Every piece resolved to a card in our catalog, or the combo isn't here.
  card_ids integer[] not null check (cardinality(card_ids) > 0),
  -- Pieces the combo needs as the commander, a subset of card_ids.
  commander_card_ids integer[] not null default '{}' check (commander_card_ids <@ card_ids),
  -- Pieces described rather than named ("Legendary Elemental Creature"): any card matching them fills the slot, so a
  -- deck holding every card in card_ids still needs one of these before the combo is real.
  template_names text[] not null default '{}',
  -- combo_features ids, ascending.
  feature_ids integer[] not null,
  -- Union of the pieces' colour identities in our catalog (bitmask W=1 U=2 B=4 R=8 G=16).
  color_identity smallint not null check (color_identity between 0 and 31),
  -- Spellbook's bracket tag: R Ruthless (bracket 4), S Spicy and P Powerful (3), O Oddball and C Core (2),
  -- E Exhibition (1), B banned in Commander.
  bracket_tag text not null check (bracket_tag in ('R', 'S', 'P', 'O', 'C', 'E', 'B')),
  -- Mana needed to run the loop once the pieces are in place, beyond casting them.
  mana_value_needed smallint not null check (mana_value_needed >= 0),
  -- Spellbook's count of EDHREC decks containing the combo. EDHREC's numbers are never displayed (CLAUDE.md).
  popularity integer check (popularity >= 0),
  -- Spellbook's ids for the generic combos this is a variant of; variants of one combo share them.
  spellbook_combo_ids integer[] not null default '{}'
);

-- "Combos touching these cards": && narrows to combos sharing a card with the deck, the rest is per-row arithmetic.
create index combos_card_ids on public.combos using gin (card_ids);

-- The combos a set of cards (a deck) completes, and with p_max_missing > 0 the ones it is that many cards short of,
-- with the cards it lacks. Template pieces and commander requirements are the caller's to check against combos.
create function public.combos_for_cards(p_card_ids integer[], p_max_missing integer default 0)
returns table (combo_id integer, missing_card_ids integer[])
language sql
stable
set search_path = ''
as $$
  select c.id, m.missing
  from public.combos c
  cross join lateral (
    select coalesce(array_agg(x order by x), '{}') as missing
    from unnest(c.card_ids) as x
    where not (x = any (p_card_ids))
  ) m
  where c.card_ids && p_card_ids
    and cardinality(m.missing) <= greatest(p_max_missing, 0)
$$;

-- Not shown to visitors yet: popularity is EDHREC's, and showing combos means crediting and linking Spellbook. Opening
-- them up is the job of whatever first displays them.
alter table public.combo_features enable row level security;
alter table public.combos enable row level security;
revoke all on public.combo_features, public.combos from anon, authenticated;
grant all on public.combo_features, public.combos to service_role;
revoke execute on function public.combos_for_cards(integer[], integer) from public, anon, authenticated;
grant execute on function public.combos_for_cards(integer[], integer) to service_role;
