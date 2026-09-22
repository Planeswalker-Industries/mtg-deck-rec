-- Editing a collection by hand: how many copies of a card the signed-in user owns, whatever the printing.
--
-- Collections are printing-level (an entry per card, printing, finish, condition and language), but the collection
-- page shows one line per card, so a hand edit is a card-level total. Copies added go into the card's generic entry
-- (no printing, nonfoil, NM, English, the same defaults an import uses); copies taken away come out of that entry
-- first, then out of the imported printings, most recently changed first, so the printings an import recorded are
-- the last to go. Only the entries that change are written. Setting 0 removes the card.
create function public.set_collection_card_quantity(p_card_id integer, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_entries integer := coalesce((select (value ->> 'maxEntries')::integer from public.app_config where key = 'collections'), 100000);
  wanted integer := greatest(coalesce(p_quantity, 0), 0);
  total integer;
  surplus integer;
  entry record;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if wanted > 100000 then
    raise exception 'COLLECTION_TOO_LARGE';
  end if;
  if not exists (select 1 from public.cards c where c.id = p_card_id and c.deleted_at is null) then
    raise exception 'CARD_NOT_FOUND';
  end if;

  -- Serialises edits to one user's collection, so two tabs can't both read the same total.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select coalesce(sum(ci.quantity), 0) into total
  from public.collection_items ci
  where ci.user_id = uid and ci.card_id = p_card_id;

  if wanted = total then
    return total;
  end if;

  if wanted = 0 then
    delete from public.collection_items ci where ci.user_id = uid and ci.card_id = p_card_id;
    return 0;
  end if;

  if wanted > total then
    if not exists (
      select 1 from public.collection_items ci
      where ci.user_id = uid and ci.card_id = p_card_id and ci.printing_id is null
        and ci.finish = 'nonfoil' and ci.condition = 'NM' and ci.lang = 'en'
    ) and (select count(*) from public.collection_items ci where ci.user_id = uid) >= max_entries then
      raise exception 'COLLECTION_TOO_LARGE';
    end if;
    insert into public.collection_items (user_id, card_id, printing_id, finish, condition, lang, quantity)
    values (uid, p_card_id, null, 'nonfoil', 'NM', 'en', wanted - total)
    on conflict (user_id, card_id, coalesce(printing_id, '00000000-0000-0000-0000-000000000000'::uuid), finish, condition, lang)
    do update set quantity = public.collection_items.quantity + excluded.quantity, updated_at = now();
    return wanted;
  end if;

  surplus := total - wanted;
  for entry in
    select ci.id, ci.quantity
    from public.collection_items ci
    where ci.user_id = uid and ci.card_id = p_card_id
    order by (ci.printing_id is null) desc, ci.updated_at desc, ci.id desc
  loop
    exit when surplus = 0;
    if entry.quantity <= surplus then
      delete from public.collection_items ci where ci.id = entry.id;
      surplus := surplus - entry.quantity;
    else
      update public.collection_items ci set quantity = ci.quantity - surplus, updated_at = now() where ci.id = entry.id;
      surplus := 0;
    end if;
  end loop;
  return wanted;
end;
$$;

revoke all on function public.set_collection_card_quantity(integer, integer) from public, anon;
grant execute on function public.set_collection_card_quantity(integer, integer) to authenticated;
