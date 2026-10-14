-- The rest of a card's oracle-level facts from Scryfall, so the app can show a card's full face without fetching it:
-- the deck journey's card panel shows power and toughness, loyalty and defense beside the rules text.
--
--   power, toughness  creatures and vehicles; text, since Scryfall writes "*", "1+*" and "X"
--   loyalty           planeswalkers' starting loyalty (text: "X" happens)
--   defense           battles
--   colors            the card's own colours (not its identity), as the colour bit mask color_identity uses
--   color_indicator   the coloured dot some cards print in place of a cost, as the same mask
--   produced_mana     the colours of mana it can add ({W} … {C}), as Scryfall lists them
--   reserved          on the Reserved List
--
-- Double-faced and split cards carry these per face in card_faces too, which sync:catalog fills.
--
-- sync:catalog fills the columns: they are in the row's content hash, so the next sync rewrites every card once. Until
-- then they are null (reserved: false), which the app reads as nothing to show. Catalog data is public: the grant
-- below repeats the catalog migration's, so the new columns are readable however the table's grants change later.
alter table public.cards
  add column power text,
  add column toughness text,
  add column loyalty text,
  add column defense text,
  add column colors smallint,
  add column color_indicator smallint,
  add column produced_mana text[],
  add column reserved boolean not null default false;

grant select on public.cards to anon, authenticated;
