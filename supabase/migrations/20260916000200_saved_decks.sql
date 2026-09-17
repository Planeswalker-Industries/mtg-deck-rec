-- Decks saved to an account (Phase 4). A deck is its name and its list of cards; the pasted text is not kept,
-- and a clean decklist is regenerated when the deck is opened in the tool.
--
-- Signed out there is no deck list at all: the tool keeps its single remembered deck in the browser. Saving is
-- always explicit, never automatic, because a new deck is public by default.
--
-- Owners read and delete their own decks directly. Everyone can read public ones. Every write goes through the
-- functions below, which run as the table owner, act only on auth.uid()'s rows, and apply app_config.decks.

insert into public.app_config (key, value, is_public)
values ('decks', '{"maxDecks": 100, "maxCards": 250, "maxNameChars": 80}'::jsonb, false)
on conflict (key) do update set value = excluded.value, updated_at = now();

update public.app_config
set value = value || '{"deck_write": {"limit": 60, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

-- uuid, not a sequence: deck ids appear in shared URLs, so they should not be guessable or enumerable, and the id
-- has to survive a rename.
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  is_public boolean not null default true,
  -- Denormalised from deck_cards on every save, so the list and the public page need no joins.
  commander_1 integer references public.cards (id),
  commander_2 integer references public.cards (id),
  color_identity smallint not null default 0,
  card_count integer not null default 0,
  bracket smallint check (bracket between 1 and 5),
  -- Aggregation is NOT gated on is_public: a private deck is hidden from others but its card choices still count
  -- toward play rates. The editor's visibility control has to say so.
  include_in_corpus boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_user on public.decks (user_id, updated_at desc);
create index decks_public on public.decks (updated_at desc) where is_public;
create index decks_corpus on public.decks (commander_1, commander_2) where include_in_corpus;

create table public.deck_cards (
  deck_id uuid not null references public.decks (id) on delete cascade,
  card_id integer not null references public.cards (id),
  section text not null check (section in ('commander', 'main')),
  quantity smallint not null check (quantity between 1 and 100),
  primary key (deck_id, card_id, section)
);

alter table public.decks enable row level security;
alter table public.deck_cards enable row level security;

create policy own_decks_read on public.decks
  for select to authenticated using (user_id = (select auth.uid()));
create policy public_decks_read on public.decks
  for select to anon, authenticated using (is_public);
create policy own_decks_delete on public.decks
  for delete to authenticated using (user_id = (select auth.uid()));

-- A deck's cards are readable exactly when the deck is.
create policy own_deck_cards_read on public.deck_cards
  for select to authenticated using (
    exists (select 1 from public.decks d where d.id = deck_id and d.user_id = (select auth.uid()))
  );
create policy public_deck_cards_read on public.deck_cards
  for select to anon, authenticated using (
    exists (select 1 from public.decks d where d.id = deck_id and d.is_public)
  );

revoke all on public.decks, public.deck_cards from anon, authenticated;
grant select on public.decks, public.deck_cards to anon, authenticated;
grant delete on public.decks to authenticated;
grant all on public.decks, public.deck_cards to service_role;

-- Deck names are shown on public pages, so control characters are stripped and the length is capped. Anything left
-- blank falls back to the commander's name, chosen by the caller.
create function public.clean_deck_name(p_name text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(trim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), greatest(p_max, 1)), '');
$$;

-- Creates or replaces one of the caller's decks. p_deck_id null creates, otherwise the deck must be theirs.
-- p_cards is [{cardId, quantity, section}]; the whole card list is replaced, and only rows that differ are written.
create function public.save_deck(p_deck_id uuid, p_name text, p_cards jsonb, p_bracket smallint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  config jsonb := coalesce((select value from public.app_config where key = 'decks'), '{}'::jsonb);
  max_decks integer := coalesce((config ->> 'maxDecks')::integer, 100);
  max_cards integer := coalesce((config ->> 'maxCards')::integer, 250);
  max_name integer := coalesce((config ->> 'maxNameChars')::integer, 80);
  v_deck_id uuid := p_deck_id;
  clean_name text := public.clean_deck_name(p_name, max_name);
  row_count_in integer := coalesce(jsonb_array_length(p_cards), 0);
  cmd1 integer;
  cmd2 integer;
  identity smallint;
  total integer;
  legal boolean;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if clean_name is null then
    raise exception 'DECK_NAME_REQUIRED';
  end if;
  if row_count_in > max_cards then
    raise exception 'DECK_TOO_LARGE';
  end if;

  if v_deck_id is null then
    if (select count(*) from public.decks d where d.user_id = uid) >= max_decks then
      raise exception 'TOO_MANY_DECKS';
    end if;
    insert into public.decks (user_id, name) values (uid, clean_name) returning id into v_deck_id;
  else
    -- Also locks the row, so concurrent saves of one deck serialise.
    update public.decks d set name = clean_name, updated_at = now()
    where d.id = v_deck_id and d.user_id = uid
    returning d.id into v_deck_id;
    if v_deck_id is null then
      raise exception 'DECK_NOT_FOUND';
    end if;
  end if;

  create temp table stg_deck_cards on commit drop as
  select
    r."cardId" as card_id,
    case when lower(coalesce(r.section, 'main')) = 'commander' then 'commander' else 'main' end as section,
    least(greatest(coalesce(r.quantity, 1), 1), 100)::smallint as quantity
  from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb)) as r("cardId" integer, quantity integer, section text)
  where r."cardId" is not null
    and exists (select 1 from public.cards c where c.id = r."cardId" and c.deleted_at is null);

  -- Only the differences are written, so an unchanged save leaves no dead rows behind.
  delete from public.deck_cards dc
  where dc.deck_id = v_deck_id
    and not exists (
      select 1 from stg_deck_cards s where s.card_id = dc.card_id and s.section = dc.section
    );

  insert into public.deck_cards (deck_id, card_id, section, quantity)
  select v_deck_id, s.card_id, s.section, s.quantity from stg_deck_cards s
  on conflict (deck_id, card_id, section) do update set quantity = excluded.quantity
  where public.deck_cards.quantity is distinct from excluded.quantity;

  select
    min(c.id) filter (where s.section = 'commander'),
    max(c.id) filter (where s.section = 'commander'),
    coalesce(bit_or(c.color_identity) filter (where s.section = 'commander'), 0)::smallint,
    coalesce(sum(s.quantity), 0)::integer,
    bool_and(c.legal_commander = 'legal')
  into cmd1, cmd2, identity, total, legal
  from stg_deck_cards s
  join public.cards c on c.id = s.card_id;

  update public.decks d
  set commander_1 = cmd1,
      commander_2 = case when cmd2 is distinct from cmd1 then cmd2 end,
      color_identity = coalesce(identity, 0),
      card_count = coalesce(total, 0),
      bracket = coalesce(p_bracket, d.bracket),
      -- Legality only. Visibility deliberately does not gate this; see the column comment.
      include_in_corpus = coalesce(legal, false) and cmd1 is not null,
      updated_at = now()
  where d.id = v_deck_id;

  drop table stg_deck_cards;
  return v_deck_id;
end;
$$;

create function public.rename_deck(p_deck_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_name integer := coalesce((select (value ->> 'maxNameChars')::integer from public.app_config where key = 'decks'), 80);
  clean_name text := public.clean_deck_name(p_name, max_name);
  hit uuid;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if clean_name is null then
    raise exception 'DECK_NAME_REQUIRED';
  end if;
  update public.decks d set name = clean_name, updated_at = now()
  where d.id = p_deck_id and d.user_id = uid
  returning d.id into hit;
  if hit is null then
    raise exception 'DECK_NOT_FOUND';
  end if;
end;
$$;

-- Hides the deck from everyone else. It keeps counting toward play rates either way.
create function public.set_deck_visibility(p_deck_id uuid, p_is_public boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hit uuid;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  update public.decks d set is_public = p_is_public, updated_at = now()
  where d.id = p_deck_id and d.user_id = uid
  returning d.id into hit;
  if hit is null then
    raise exception 'DECK_NOT_FOUND';
  end if;
end;
$$;

-- Copies one of the caller's decks, subject to the same cap as a new deck.
create function public.duplicate_deck(p_deck_id uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  config jsonb := coalesce((select value from public.app_config where key = 'decks'), '{}'::jsonb);
  max_decks integer := coalesce((config ->> 'maxDecks')::integer, 100);
  max_name integer := coalesce((config ->> 'maxNameChars')::integer, 80);
  source public.decks;
  new_id uuid;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into source from public.decks d where d.id = p_deck_id and d.user_id = uid;
  if source.id is null then
    raise exception 'DECK_NOT_FOUND';
  end if;
  if (select count(*) from public.decks d where d.user_id = uid) >= max_decks then
    raise exception 'TOO_MANY_DECKS';
  end if;

  insert into public.decks (user_id, name, is_public, commander_1, commander_2, color_identity, card_count, bracket, include_in_corpus)
  values (
    uid,
    coalesce(public.clean_deck_name(p_name, max_name), public.clean_deck_name(left(source.name, max_name - 7) || ' (copy)', max_name)),
    source.is_public, source.commander_1, source.commander_2, source.color_identity, source.card_count, source.bracket, source.include_in_corpus
  )
  returning id into new_id;

  insert into public.deck_cards (deck_id, card_id, section, quantity)
  select new_id, dc.card_id, dc.section, dc.quantity from public.deck_cards dc where dc.deck_id = p_deck_id;

  return new_id;
end;
$$;

revoke all on function public.clean_deck_name(text, integer) from public;
revoke all on function public.save_deck(uuid, text, jsonb, smallint) from public;
revoke all on function public.rename_deck(uuid, text) from public;
revoke all on function public.set_deck_visibility(uuid, boolean) from public;
revoke all on function public.duplicate_deck(uuid, text) from public;

grant execute on function public.save_deck(uuid, text, jsonb, smallint) to authenticated;
grant execute on function public.rename_deck(uuid, text) to authenticated;
grant execute on function public.set_deck_visibility(uuid, boolean) to authenticated;
grant execute on function public.duplicate_deck(uuid, text) to authenticated;

comment on column public.decks.include_in_corpus is
  'Set from legality only. A private deck is hidden from others but still counts toward play rates; the editor must say so.';
comment on column public.decks.is_public is
  'New decks are public. Controls the shared page only, never whether the deck feeds aggregates.';
