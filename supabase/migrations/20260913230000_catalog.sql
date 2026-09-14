-- Card catalog: oracle-level cards, printing-level rows, name aliases.
-- Written by the ingestion worker (service role); read by everyone.

create extension if not exists pg_trgm with schema extensions;

-- One row per supported format. Commander is the only implementation; this is the seam for a second one.
create table public.formats (
  code text primary key,
  name text not null,
  deck_size smallint not null,
  singleton boolean not null,
  uses_color_identity boolean not null,
  has_command_zone boolean not null,
  scryfall_legality_key text not null
);

insert into public.formats (code, name, deck_size, singleton, uses_color_identity, has_command_zone, scryfall_legality_key)
values ('commander', 'Commander', 100, true, true, true, 'commander');

-- Oracle-level card. `id` is a compact surrogate, 1:1 with oracle_id and never reissued.
create table public.cards (
  id integer generated always as identity primary key,
  oracle_id uuid not null unique,
  name text not null,
  name_normalized text not null,
  slug text not null unique,
  layout text not null,
  mana_value real not null,
  type_line text not null,
  oracle_text text,
  card_faces jsonb,
  color_identity smallint not null check (color_identity between 0 and 31), -- bitmask W=1 U=2 B=4 R=8 G=16
  is_basic_land boolean not null,
  can_be_commander boolean not null,
  partner_kind text,
  partner_qualifier text,
  copy_limit smallint, -- null = format default; 0 = unlimited
  legal_commander text not null check (legal_commander in ('legal', 'not_legal', 'banned', 'restricted')),
  legalities jsonb not null,
  game_changer boolean not null default false,
  is_digital_only boolean not null,
  released_at date,
  images jsonb, -- { front: {small, normal, large, artCrop}, back: {...} | null } from Scryfall's CDN
  scryfall_uri text not null,
  reference_price_usd numeric(10, 2),
  reference_price_finish text check (reference_price_finish in ('nonfoil', 'foil', 'etched')),
  prices_as_of timestamptz,
  content_hash bytea not null, -- excludes prices, so price-only changes don't count as card changes
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index cards_name_trgm on public.cards using gin (name_normalized extensions.gin_trgm_ops);
create index cards_commander_pool on public.cards (color_identity) include (mana_value, game_changer)
  where legal_commander = 'legal' and not is_basic_land and deleted_at is null;

-- Every name a decklist might use for a card: full name, face names, flavor/printed names, Alchemy A- names.
create table public.card_names (
  card_id integer not null references public.cards (id) on delete cascade,
  name_normalized text not null,
  kind text not null check (kind in ('full', 'face', 'flavor', 'printed', 'alchemy')),
  primary key (name_normalized, card_id, kind)
);

create index card_names_trgm on public.card_names using gin (name_normalized extensions.gin_trgm_ops);

-- Printing-level rows from All Cards (slim projection). Collections resolve against these.
create table public.printings (
  id uuid primary key, -- Scryfall card id
  card_id integer not null references public.cards (id),
  set_code text not null,
  collector_number text not null,
  lang text not null,
  finishes text[] not null,
  is_digital boolean not null,
  tcgplayer_id integer,
  tcgplayer_etched_id integer,
  usd numeric(10, 2),
  usd_foil numeric(10, 2),
  usd_etched numeric(10, 2),
  prices_as_of timestamptz,
  released_at date,
  content_hash bytea not null,
  deleted_at timestamptz
);

create index printings_set_cn on public.printings (set_code, collector_number, lang);
create index printings_card on public.printings (card_id);
create index printings_tcgplayer on public.printings (tcgplayer_id) where tcgplayer_id is not null;
create index printings_tcgplayer_etched on public.printings (tcgplayer_etched_id) where tcgplayer_etched_id is not null;

-- Old slugs keep resolving after a card is renamed, so indexed URLs don't break.
create table public.slug_redirects (
  old_slug text primary key,
  kind text not null check (kind in ('card', 'commander')),
  target_id bigint not null
);

-- Public reference data: anyone can read; only the service role (which bypasses RLS) writes.
do $$
declare t text;
begin
  foreach t in array array['formats', 'cards', 'card_names', 'printings', 'slug_redirects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- New tables are not exposed to the Data API roles automatically (see supabase/config.toml), so grant explicitly.
grant select on public.formats, public.cards, public.card_names, public.printings, public.slug_redirects
  to anon, authenticated;
grant all on public.formats, public.cards, public.card_names, public.printings, public.slug_redirects
  to service_role;
