-- save_deck wrote every staged row in one upsert, so a card sent twice under the same section failed the whole save
-- with "ON CONFLICT DO UPDATE command cannot affect row a second time". The deckbuilder sends each commander twice
-- (a DeckInput keeps it in `commanders` and in `cards`), so setting a commander on a saved deck could never save.
-- The app now sends each card once; staging also folds repeats, so no caller can hit this again.
-- Identical to 20260916000200_saved_decks.sql apart from the staging select.

create or replace function public.save_deck(p_deck_id uuid default null, p_name text default null, p_cards jsonb default '[]'::jsonb, p_bracket smallint default null)
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
      -- Legality only. Visibility deliberately does not gate this; see the column comment.
      include_in_corpus = coalesce(legal, false) and cmd1 is not null,
      updated_at = now()
  where d.id = v_deck_id;

  drop table stg_deck_cards;
  return v_deck_id;
end;
$$;

revoke all on function public.save_deck(uuid, text, jsonb, smallint) from public;
grant execute on function public.save_deck(uuid, text, jsonb, smallint) to authenticated;
