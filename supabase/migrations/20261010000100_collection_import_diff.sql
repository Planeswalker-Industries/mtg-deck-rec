-- Preserve untouched identities, physical row versions and provenance.
create or replace function public.commit_collection_import(p_import_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Existing per-entry copy cap and fallback entry limit; no limit changes.
  quantity_cap_copies constant integer := 100000;
  default_max_entries_count constant integer := 100000;
  uid uuid := auth.uid();
  max_entries integer := coalesce((select (value ->> 'maxEntries')::integer from public.app_config where key = 'collections'), default_max_entries_count);
  import_mode text;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  -- Shared with hand edits, before any collection read/write. The import row
  -- update also serialises commit against staging batches and repeat commits.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  update public.collection_imports i
  set status = 'committed', committed_at = now()
  where i.id = p_import_id and i.user_id = uid and i.status = 'open'
  returning i.mode into import_mode;
  if import_mode is null then
    raise exception 'IMPORT_NOT_OPEN';
  end if;
  if import_mode = 'replace' then
    delete from public.collection_items ci
    where ci.user_id = uid and not exists (
      select 1 from public.collection_import_rows r
      join public.cards c on c.id = r.card_id
      left join public.printings p on p.id = r.printing_id and p.card_id = r.card_id
      where r.import_id = p_import_id and r.card_id = ci.card_id
        and p.id is not distinct from ci.printing_id
        and r.finish = ci.finish and r.condition = ci.condition and r.lang = ci.lang
    );
  end if;
  with normalized as materialized (
    select r.card_id, p.id as printing_id, r.finish, r.condition, r.lang,
      least(sum(r.quantity), quantity_cap_copies)::integer as quantity
    from public.collection_import_rows r
    join public.cards c on c.id = r.card_id
    left join public.printings p on p.id = r.printing_id and p.card_id = r.card_id
    where r.import_id = p_import_id
    group by r.card_id, p.id, r.finish, r.condition, r.lang
  ), changed as (
    update public.collection_items ci
    set quantity = case when import_mode = 'merge' then least(ci.quantity + n.quantity, quantity_cap_copies) else n.quantity end,
        import_id = p_import_id, updated_at = now()
    from normalized n
    where ci.user_id = uid and ci.card_id = n.card_id
      and ci.printing_id is not distinct from n.printing_id
      and ci.finish = n.finish and ci.condition = n.condition and ci.lang = n.lang
      and ci.quantity is distinct from
        case when import_mode = 'merge' then least(ci.quantity + n.quantity, quantity_cap_copies) else n.quantity end
    returning ci.id
  )
  insert into public.collection_items (user_id, card_id, printing_id, finish, condition, lang, quantity, import_id)
  select uid, n.card_id, n.printing_id, n.finish, n.condition, n.lang, n.quantity, p_import_id
  from normalized n
  where not exists (
    select 1 from public.collection_items ci
    where ci.user_id = uid and ci.card_id = n.card_id
      and ci.printing_id is not distinct from n.printing_id
      and ci.finish = n.finish and ci.condition = n.condition and ci.lang = n.lang
  )
  on conflict do nothing;
  if (select count(*) from public.collection_items ci where ci.user_id = uid) > max_entries then
    raise exception 'COLLECTION_TOO_LARGE';
  end if;
  delete from public.collection_import_rows r where r.import_id = p_import_id;
  return public.my_collection_totals();
end;
$$;
revoke execute on function public.commit_collection_import(bigint) from public, anon;
grant execute on function public.commit_collection_import(bigint) to authenticated, service_role;
