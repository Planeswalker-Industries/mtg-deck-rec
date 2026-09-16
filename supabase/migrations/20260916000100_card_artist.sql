-- The artist of a card's representative printing, so art crops can be shown with the credit
-- Scryfall's guidelines require. Same printing the `images` column comes from, so the two stay in step.
alter table public.cards add column if not exists artist text;

comment on column public.cards.artist is
  'Artist of the representative printing, matching images->front. Null until the next catalog sync fills it.';
