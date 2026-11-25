-- An admin opens one account's collection to fix a problem or answer a report: its totals, its import history, and a
-- card-name search over its entries. There is no full listing: a collection can hold 100,000 entries, and a search is
-- all a support question needs.
--
-- Both functions return one jsonb value, so PostgREST's row cap can't truncate them, and both are volatile: every call
-- writes one audit_log row (ids and sizes only, never what the admin searched for). That row is the record /privacy
-- promises when it says each look is recorded. No email address leaves either function.

-- Totals and import history. The value is each entry's quantity times its printing's price for the entry's finish;
-- an entry with no printing, or whose printing has no price for that finish, counts in unpricedEntries instead.
create or replace function public.admin_user_collection(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- 50: an import commits in seconds and start_collection_import prunes old open ones, so even a busy account's
  -- history fits; the screen lists them on one page.
  c_max_imports constant integer := 50;
  v_actor uuid := public.require_platform_admin();
  v_totals jsonb;
  v_imports jsonb;
  v_shared boolean;
begin
  select jsonb_build_object(
           'entries', count(*),
           'distinctCards', count(distinct e.card_id),
           'totalQuantity', coalesce(sum(e.quantity), 0),
           'valueUsd', coalesce(round(sum(e.quantity * e.price), 2), 0),
           'unpricedEntries', count(*) filter (where e.price is null))
    into v_totals
  from (
    select
      ci.card_id,
      ci.quantity,
      case ci.finish when 'foil' then p.usd_foil when 'etched' then p.usd_etched else p.usd end as price
    from public.collection_items ci
    left join public.printings p on p.id = ci.printing_id
    where ci.user_id = p_user_id
  ) e;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.id desc), '[]'::jsonb)
    into v_imports
  from (
    select
      i.id,
      i.source_app as "sourceApp",
      i.mode,
      i.status,
      i.rows_total as "rowsTotal",
      i.created_at as "createdAt",
      i.committed_at as "committedAt"
    from public.collection_imports i
    where i.user_id = p_user_id
    order by i.id desc
    limit c_max_imports
  ) x;

  select s.is_shared into v_shared from public.collection_shares s where s.user_id = p_user_id;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.view_user_collection', jsonb_build_object('user_id', p_user_id));

  return v_totals || jsonb_build_object(
    'pricesAsOf', public.prices_checked_at(),
    'shared', coalesce(v_shared, false),
    'imports', v_imports);
end;
$$;

revoke execute on function public.admin_user_collection(uuid) from public, anon;
grant execute on function public.admin_user_collection(uuid) to authenticated, service_role;

-- Entries whose card name contains the search, a page at a time, by name then set and number. The app normalizes the
-- search the way cards.name_normalized is built (accents stripped, case folded), so this is a plain substring match
-- over one account's entries. A search shorter than two characters matches nothing: it would list the collection.
create or replace function public.admin_user_collection_items(
  p_user_id uuid,
  p_search text,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- 2: one letter matches nearly every card, which would make the search a full listing by another name.
  c_min_search_chars constant integer := 2;
  -- 50: a page of results on a phone; the screen pages through the rest.
  c_max_page constant integer := 50;
  v_actor uuid := public.require_platform_admin();
  v_search text := coalesce(btrim(p_search), '');
  v_pattern text;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, c_max_page), 1), c_max_page);
  v_result jsonb := jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
begin
  if char_length(v_search) >= c_min_search_chars then
    v_pattern := '%' || replace(replace(replace(lower(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';

    with matches as (
      select
        c.name as card_name,
        p.set_code,
        p.collector_number,
        ci.finish,
        ci.condition,
        ci.lang,
        ci.quantity,
        ci.id
      from public.collection_items ci
      join public.cards c on c.id = ci.card_id
      left join public.printings p on p.id = ci.printing_id
      where ci.user_id = p_user_id
        and c.name_normalized like v_pattern
    ),
    page as (
      select *
      from matches m
      order by m.card_name, m.set_code nulls first, m.collector_number, m.id
      offset v_offset
      limit v_limit
    )
    select jsonb_build_object(
             'total', (select count(*) from matches),
             'rows', coalesce(
               (select jsonb_agg(
                         jsonb_build_object(
                           'cardName', pg.card_name,
                           'setCode', pg.set_code,
                           'collectorNumber', pg.collector_number,
                           'finish', pg.finish,
                           'condition', pg.condition,
                           'lang', pg.lang,
                           'quantity', pg.quantity)
                         order by pg.card_name, pg.set_code nulls first, pg.collector_number, pg.id)
                from page pg),
               '[]'::jsonb))
      into v_result;
  end if;

  -- The search's length, never its text: the row records that a look happened, not what the admin looked for.
  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.search_user_collection',
          jsonb_build_object('user_id', p_user_id, 'search_chars', char_length(v_search), 'offset', v_offset));

  return v_result;
end;
$$;

revoke execute on function public.admin_user_collection_items(uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_user_collection_items(uuid, text, integer, integer) to authenticated, service_role;
