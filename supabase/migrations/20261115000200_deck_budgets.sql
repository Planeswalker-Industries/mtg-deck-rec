-- Budgets on saved decks (T091, contract v37; owner approved 2026-11-14).
--
-- 1. public.deck_budgets: the owner's per-card cap and spend for a deck. Not a column on public.decks, which anon and
--    authenticated may select for every public deck: a deck maker's budget is theirs alone. No API role reads the
--    table; only the security-definer functions below do, keyed on auth.uid(). Corpus and aggregates never read it.
-- 2. save_deck takes the budget (p_budget): null keeps the stored one, {} clears it, values are written only when they
--    change.
-- 3. my_deck_budget reads it back for the deck's owner, null for anyone else.
-- 4. duplicate_deck copies it (it only ever duplicates the caller's own decks).

create table public.deck_budgets (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  card_cap_usd numeric(10,2) check (card_cap_usd >= 0),
  spend_usd numeric(10,2) check (spend_usd >= 0),
  updated_at timestamptz not null default now(),
  constraint deck_budgets_some_limit check (card_cap_usd is not null or spend_usd is not null)
);

comment on table public.deck_budgets is
  'The deck owner''s budget: most an unowned card may cost, and most a round may spend. Owner-only, read and written by save_deck, my_deck_budget and duplicate_deck.';

alter table public.deck_budgets enable row level security;
revoke all on public.deck_budgets from anon, authenticated;
grant all on public.deck_budgets to service_role;

-- A new argument is a new signature: the old function goes, so a call without the argument still finds exactly one.
-- Identical to 20261111000100_fix_journey.sql apart from p_budget.
drop function public.save_deck(uuid, text, jsonb, smallint, jsonb);

create function public.save_deck(
  p_deck_id uuid default null,
  p_name text default null,
  p_cards jsonb default '[]'::jsonb,
  p_bracket smallint default null,
  p_stat_choices jsonb default null,
  p_budget jsonb default null
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
  -- Mirrors MAX_BUDGET_USD in the app's schema: an input sanity bound, far above any deck's cost.
  max_budget numeric := coalesce((config ->> 'maxBudgetUsd')::numeric, 100000);
  budget_cap numeric(10,2);
  budget_spend numeric(10,2);
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
  if p_budget is not null then
    if jsonb_typeof(p_budget) <> 'object'
      or exists (select 1 from jsonb_object_keys(p_budget) k where k not in ('cardCapUsd', 'spendUsd'))
      or exists (
        select 1 from jsonb_each(p_budget) b
        where jsonb_typeof(b.value) <> 'number' or (b.value #>> '{}')::numeric not between 0 and max_budget
      )
    then
      raise exception 'INVALID_BUDGET';
    end if;
    budget_cap := (p_budget ->> 'cardCapUsd')::numeric;
    budget_spend := (p_budget ->> 'spendUsd')::numeric;
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

  -- Null keeps the stored budget; an empty one clears it; otherwise the row is written only when it changes.
  if p_budget is not null then
    if budget_cap is null and budget_spend is null then
      delete from public.deck_budgets b where b.deck_id = v_deck_id;
    else
      insert into public.deck_budgets (deck_id, card_cap_usd, spend_usd)
      values (v_deck_id, budget_cap, budget_spend)
      on conflict (deck_id) do update set card_cap_usd = excluded.card_cap_usd, spend_usd = excluded.spend_usd, updated_at = now()
      where (public.deck_budgets.card_cap_usd, public.deck_budgets.spend_usd) is distinct from (excluded.card_cap_usd, excluded.spend_usd);
    end if;
  end if;

  drop table stg_deck_cards;
  return v_deck_id;
end;
$$;

revoke all on function public.save_deck(uuid, text, jsonb, smallint, jsonb, jsonb) from public, anon;
grant execute on function public.save_deck(uuid, text, jsonb, smallint, jsonb, jsonb) to authenticated;

-- The owner's budget as the app reads it, {"cardCapUsd": …, "spendUsd": …} with unset fields left out; null when the
-- caller doesn't own the deck or saved no budget.
create function public.my_deck_budget(p_deck_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('cardCapUsd', b.card_cap_usd, 'spendUsd', b.spend_usd))
  from public.deck_budgets b
  join public.decks d on d.id = b.deck_id
  where b.deck_id = p_deck_id and d.user_id = auth.uid();
$$;

revoke all on function public.my_deck_budget(uuid) from public, anon;
grant execute on function public.my_deck_budget(uuid) to authenticated;

-- Identical to 20261111000100_fix_journey.sql apart from the budget.
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

  -- The source is the caller's own deck (checked above), so its budget comes along.
  insert into public.deck_budgets (deck_id, card_cap_usd, spend_usd)
  select new_id, b.card_cap_usd, b.spend_usd from public.deck_budgets b where b.deck_id = p_deck_id;

  return new_id;
end;
$$;

revoke all on function public.duplicate_deck(uuid, text) from public;
grant execute on function public.duplicate_deck(uuid, text) to authenticated;
