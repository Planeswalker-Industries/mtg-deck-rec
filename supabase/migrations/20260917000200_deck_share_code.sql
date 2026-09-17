-- A deck's URL uses a short random code, never anything derived from its name.
--
-- The name is user-written and can change; a code cannot leak what a deck is called, cannot collide with another
-- deck's name, and survives a rename. The commander slug in the path beside it is decoration for readability, so a
-- deck is always found by its code alone and a stale commander segment still resolves.

create function public.new_deck_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 9 random bytes give 12 base64 characters. + / = are swapped out so the code is safe in a path.
  select translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz');
$$;

alter table public.decks add column if not exists code text;

-- Existing rows first, then the constraints, so the column can be NOT NULL.
update public.decks set code = public.new_deck_code() where code is null;

alter table public.decks
  alter column code set default public.new_deck_code(),
  alter column code set not null,
  add constraint decks_code_shape check (char_length(code) between 8 and 32 and code ~ '^[A-Za-z0-9]+$');

create unique index decks_code on public.decks (code);

comment on column public.decks.code is
  'Short random code used in the deck URL. Never derived from the deck name, and stable across renames.';
