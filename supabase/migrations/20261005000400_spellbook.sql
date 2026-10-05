-- Commander Spellbook's combos, raw: what its published daily export (json.commanderspellbook.com/variants.json.gz)
-- says, in its own identifiers (Scryfall oracle ids, its own feature ids), written only by `sync:spellbook`. Nothing
-- here depends on our card catalog, so a load never waits for `sync:catalog`; the collator (T054) resolves combos into
-- corpus.spellbook_combos, and only collated rows feed scoring. docs/roadmap/card-graph-plan.md, "Data layers".
--
-- Not stored: step descriptions and prerequisites (about 50 MB of prose a day, which a link to the combo's page
-- covers), prices (ours come from Scryfall), images, other formats' legality, and salt.

-- What a combo produces ("Infinite colored mana", "Win the game"), keyed by Spellbook's own feature id.
create table spellbook.features (
  id integer primary key,
  name text not null check (name <> ''),
  -- As Spellbook publishes it: S a standalone result, C a result that matters in context, H a hidden step it chains
  -- combos through ("Infinite creature ETB") and never shows. Interpreting it is the collator's job, so a new status
  -- lands here rather than failing the load.
  status text not null check (status <> '')
);

-- One row per Spellbook variant: one exact set of cards that makes a combo.
create table spellbook.combos (
  -- Spellbook's variant id, e.g. '2645-5640-7935'; its page is commanderspellbook.com/combo/<id>/.
  variant_id text primary key check (variant_id <> ''),
  -- The named pieces as Scryfall oracle ids, ascending and distinct, with each piece's name at the same position.
  card_oracle_ids uuid[] not null check (cardinality(card_oracle_ids) > 0),
  card_names text[] not null,
  -- Pieces the combo needs as the commander, a subset of card_oracle_ids.
  commander_oracle_ids uuid[] not null default '{}',
  -- Pieces described rather than named ("Legendary Elemental Creature"): any card matching one fills it.
  template_names text[] not null default '{}',
  -- spellbook.features ids, ascending.
  feature_ids integer[] not null,
  -- Spellbook's bracket tag as published (SPELLBOOK_BRACKET_TAGS in @mtg/core/parse lists the known ones); the
  -- collator maps it to a minimum bracket.
  bracket_tag text not null check (bracket_tag <> ''),
  -- Mana needed to run the loop once the pieces are in place, beyond casting them.
  mana_value_needed smallint not null check (mana_value_needed >= 0),
  -- Spellbook's count of EDHREC decks holding the combo. EDHREC's numbers are never displayed (CLAUDE.md), and this
  -- one never leaves raw.
  edhrec_deck_count integer check (edhrec_deck_count >= 0),
  -- Spellbook's ids for the generic combos this variant is an instance of; variants of one combo share them.
  combo_ids integer[] not null default '{}',
  constraint combos_card_names_aligned check (cardinality(card_names) = cardinality(card_oracle_ids)),
  constraint combos_commander_pieces check (commander_oracle_ids <@ card_oracle_ids)
);

-- Private like every raw schema: the schema grants usage to service_role only (20261005000200_data_layers.sql), and
-- RLS with no policies keeps API roles out even if a grant slips in.
alter table spellbook.features enable row level security;
alter table spellbook.combos enable row level security;
revoke all on spellbook.features, spellbook.combos from anon, authenticated;
grant all on spellbook.features, spellbook.combos to service_role;
