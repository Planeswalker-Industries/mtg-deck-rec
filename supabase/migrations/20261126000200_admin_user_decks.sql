-- An admin opens one account's saved decks, public or private, to fix a problem or answer a report.
--
-- Both functions return one jsonb value, so PostgREST's row cap can't truncate them, and both are volatile: every call
-- writes one audit_log row (ids only, never deck content). That row is the record /privacy promises when it says
-- each look is recorded. No email address leaves either function.

-- Every deck the account saved, newest first. Capped far above any real account (the deck list has no paging) so a
-- runaway account can't turn one admin click into an unbounded read.
create or replace function public.admin_user_decks(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- 500: far above any real account's saved decks; the screen lists them all on one page.
  c_max_decks constant integer := 500;
  v_actor uuid := public.require_platform_admin();
  v_decks jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x."updatedAt" desc, x.id), '[]'::jsonb)
    into v_decks
  from (
    select
      d.id,
      d.code,
      d.name,
      d.is_public as "isPublic",
      d.is_built as "isBuilt",
      array_remove(array[d.commander_1, d.commander_2], null) as "commanderIds",
      d.card_count as "cardCount",
      d.bracket,
      d.created_at as "createdAt",
      d.updated_at as "updatedAt"
    from public.decks d
    where d.user_id = p_user_id
    order by d.updated_at desc, d.id
    limit c_max_decks
  ) x;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.view_user_decks', jsonb_build_object('user_id', p_user_id));

  return v_decks;
end;
$$;

revoke execute on function public.admin_user_decks(uuid) from public, anon;
grant execute on function public.admin_user_decks(uuid) to authenticated, service_role;

-- One deck's cards, commanders first, then by name. A missing deck returns an empty list and still writes its audit
-- row: the look happened, and the row says which id was asked for.
create or replace function public.admin_deck_cards(p_deck_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_platform_admin();
  v_owner uuid;
  v_cards jsonb;
begin
  select d.user_id into v_owner from public.decks d where d.id = p_deck_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('cardId', dc.card_id, 'name', c.name, 'section', dc.section, 'quantity', dc.quantity)
             order by (dc.section = 'commander') desc, c.name, dc.card_id
           ),
           '[]'::jsonb)
    into v_cards
  from public.deck_cards dc
  join public.cards c on c.id = dc.card_id
  where dc.deck_id = p_deck_id;

  insert into public.audit_log (actor, action, payload)
  values (v_actor, 'admin.view_deck', jsonb_build_object('deck_id', p_deck_id, 'user_id', v_owner));

  return v_cards;
end;
$$;

revoke execute on function public.admin_deck_cards(uuid) from public, anon;
grant execute on function public.admin_deck_cards(uuid) to authenticated, service_role;
