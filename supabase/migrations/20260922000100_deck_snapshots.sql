-- The deck a player brought, kept beside the deck they saved, so the deck page can compare the two and put the
-- original back. One row per deck and kind; 'original' is the only kind for now, and the key leaves room for a
-- version history later without another table.
--
-- The cards are one jsonb value ([{cardId, quantity, section}]) rather than rows: a snapshot is written once and read
-- whole, never queried card by card, and a row per card would double deck_cards' size for a feature most decks
-- never use.
create table public.deck_snapshots (
  deck_id uuid not null references public.decks (id) on delete cascade,
  kind text not null check (kind in ('original')),
  cards jsonb not null,
  created_at timestamptz not null default now(),
  primary key (deck_id, kind)
);

alter table public.deck_snapshots enable row level security;

-- Readable exactly when the deck is, like deck_cards.
create policy own_deck_snapshots_read on public.deck_snapshots
  for select to authenticated using (
    exists (select 1 from public.decks d where d.id = deck_id and d.user_id = (select auth.uid()))
  );
create policy public_deck_snapshots_read on public.deck_snapshots
  for select to anon, authenticated using (
    exists (select 1 from public.decks d where d.id = deck_id and d.is_public)
  );

revoke all on public.deck_snapshots from anon, authenticated;
grant select on public.deck_snapshots to anon, authenticated;
grant all on public.deck_snapshots to service_role;

-- Keeps the original of one of the caller's decks. Written once: a deck already carrying an original keeps it, so
-- saving the deck again after another round of changes never moves what "original" means. Unknown card ids and
-- sections outside the deck are dropped, and the same card cap as save_deck applies.
create function public.save_deck_original(p_deck_id uuid, p_cards jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_cards integer := coalesce(((select value from public.app_config where key = 'decks') ->> 'maxCards')::integer, 250);
  clean jsonb;
  written integer;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if coalesce(jsonb_array_length(p_cards), 0) > max_cards then
    raise exception 'DECK_TOO_LARGE';
  end if;
  if not exists (select 1 from public.decks d where d.id = p_deck_id and d.user_id = uid) then
    raise exception 'DECK_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('cardId', r."cardId", 'quantity', r.quantity, 'section', r.section) order by r.section, r."cardId"), '[]'::jsonb)
  into clean
  from jsonb_to_recordset(p_cards) as r("cardId" integer, quantity smallint, section text)
  where r.section in ('commander', 'main')
    and r.quantity between 1 and 100
    and exists (select 1 from public.cards c where c.id = r."cardId");

  insert into public.deck_snapshots (deck_id, kind, cards)
  values (p_deck_id, 'original', clean)
  on conflict (deck_id, kind) do nothing;
  get diagnostics written = row_count;
  return written > 0;
end;
$$;

revoke all on function public.save_deck_original(uuid, jsonb) from public, anon;
grant execute on function public.save_deck_original(uuid, jsonb) to authenticated;
