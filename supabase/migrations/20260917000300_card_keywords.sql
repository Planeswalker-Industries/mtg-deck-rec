-- Scryfall's rules keywords per card (Deathtouch, Menace, Flying, Trample), so the deck workspace can group a deck
-- by keyword alongside card type and functional tags.
--
-- These are rules keywords only. "Life gain", "removal" and the like are Tagger tags and live in card_tags; the two
-- groupings are deliberately separate because they come from different sources with different reliability.

alter table public.cards add column if not exists keywords text[] not null default '{}';

-- Grouping a deck asks "which of these cards have keyword X", which is a containment test.
create index if not exists cards_keywords on public.cards using gin (keywords);

comment on column public.cards.keywords is
  'Scryfall rules keywords for the card. Empty until the next catalog sync fills it; part of content_hash, so that sync rewrites every row once.';
