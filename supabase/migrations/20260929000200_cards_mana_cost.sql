-- The printed mana cost, as Scryfall writes it ({2}{W}{W}), for the deckbuilder's decklist rows, which show the cost
-- symbols rather than the total. A split card keeps both halves ("{1}{R} // {1}{U}"); a double-faced card has its front
-- face's cost. Lands and other costless cards hold an empty string.
--
-- sync:catalog fills it: the column is in the row's content hash, so the next sync rewrites every card once. Until
-- then it is null, which the app reads as no cost to show.
alter table public.cards add column mana_cost text;
