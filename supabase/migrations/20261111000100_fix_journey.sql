-- The Fix step's server side (T086, contract v35; owner approved 2026-11-11).
--
-- 1. decks.stat_choices: what the player chose for a Deck stats line the deck can't bring in line, by line key:
--    {"<line key>": "ignore" | "buy"}. "ignore" leaves the line out of the score; "buy" opens it to unowned cards.
--    Saved with the deck, so the choice is asked once.
-- 2. save_deck takes the choices (p_stat_choices). Null keeps the stored ones, so a client that doesn't send them
--    changes nothing.
-- 3. duplicate_deck copies them with the deck.
-- 4. POST /api/recs/fix has its own request budget.

-- A constant default, so existing rows are not rewritten. The column is read under the table's existing grants
-- (select for anon and authenticated, behind the decks policies): the owner's deck tool reads it, and it holds nothing
-- a public deck page doesn't already show (which Deck stats lines the owner set aside).
alter table public.decks
  add column stat_choices jsonb not null default '{}'::jsonb
  constraint decks_stat_choices_object check (jsonb_typeof(stat_choices) = 'object');

comment on column public.decks.stat_choices is
  'The player''s choices for Deck stats lines, by line key: {"<line key>": "ignore" | "buy"}. Written by save_deck only.';

-- A new argument is a new signature: the old function goes, so a call without the argument still finds exactly one.
-- Identical to 20260922000500_save_deck_duplicate_rows.sql apart from p_stat_choices.
drop function public.save_deck(uuid, text, jsonb, smallint);

create function public.save_deck(
  p_deck_id uuid default null,
  p_name text default null,
  p_cards jsonb default '[]'::jsonb,
  p_bracket smallint default null,
  p_stat_choices jsonb default null
)
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
  -- About twice the lines Deck stats shows; the app's schema (MAX_STAT_CHOICES) refuses more before this does.
  max_stat_choices integer := coalesce((config ->> 'maxStatChoices')::integer, 32);
  -- A line key is a role's tag id (a UUID), a card type, 'curve', 'lands', 'basicLands' or 'sources:B'.
  max_stat_key integer := coalesce((config ->> 'maxStatChoiceKeyChars')::integer, 64);
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
  if p_stat_choices is not null then
    if jsonb_typeof(p_stat_choices) <> 'object' then
      raise exception 'INVALID_STAT_CHOICES';
    end if;
    if (select count(*) from jsonb_object_keys(p_stat_choices)) > max_stat_choices
      or exists (
        select 1 from jsonb_each(p_stat_choices) c
        where char_length(c.key) not between 1 and max_stat_key
          or jsonb_typeof(c.value) <> 'string'
          or (c.value #>> '{}') not in ('ignore', 'buy')
      )
    then
      raise exception 'INVALID_STAT_CHOICES';
    end if;
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

  -- One row per card and section: the upsert below fails when a key repeats. A commander sent twice is still one
  -- commander; repeated main entries add up.
  create temp table stg_deck_cards on commit drop as
  select
    r.card_id,
    r.section,
    case when r.section = 'commander' then max(r.quantity) else least(sum(r.quantity), 100) end::smallint as quantity
  from (
    select
      j."cardId" as card_id,
      case when lower(coalesce(j.section, 'main')) = 'commander' then 'commander' else 'main' end as section,
      least(greatest(coalesce(j.quantity, 1), 1), 100) as quantity
    from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb)) as j("cardId" integer, quantity integer, section text)
    where j."cardId" is not null
      and exists (select 1 from public.cards c where c.id = j."cardId" and c.deleted_at is null)
  ) r
  group by r.card_id, r.section;

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
      -- Null keeps the stored choices, as a null bracket keeps the bracket.
      stat_choices = coalesce(p_stat_choices, d.stat_choices),
      -- Legality only. Visibility deliberately does not gate this; see the column comment.
      include_in_corpus = coalesce(legal, false) and cmd1 is not null,
      updated_at = now()
  where d.id = v_deck_id;

  drop table stg_deck_cards;
  return v_deck_id;
end;
$$;

revoke all on function public.save_deck(uuid, text, jsonb, smallint, jsonb) from public;
grant execute on function public.save_deck(uuid, text, jsonb, smallint, jsonb) to authenticated;

-- Identical to 20260916000200_saved_decks.sql apart from stat_choices.
create or replace function public.duplicate_deck(p_deck_id uuid, p_name text default null)
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

  insert into public.decks (user_id, name, is_public, commander_1, commander_2, color_identity, card_count, bracket, include_in_corpus, stat_choices)
  values (
    uid,
    coalesce(public.clean_deck_name(p_name, max_name), public.clean_deck_name(left(source.name, max_name - 7) || ' (copy)', max_name)),
    source.is_public, source.commander_1, source.commander_2, source.color_identity, source.card_count, source.bracket, source.include_in_corpus,
    source.stat_choices
  )
  returning id into new_id;

  insert into public.deck_cards (deck_id, card_id, section, quantity)
  select new_id, dc.card_id, dc.section, dc.quantity from public.deck_cards dc where dc.deck_id = p_deck_id;

  return new_id;
end;
$$;

revoke all on function public.duplicate_deck(uuid, text) from public;
grant execute on function public.duplicate_deck(uuid, text) to authenticated;

-- Fix reads its pool when the step opens and again after each auto-fix: a few requests a round.
update public.app_config
set value = value || '{"fix": {"limit": 30, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits' and not value ? 'fix';
