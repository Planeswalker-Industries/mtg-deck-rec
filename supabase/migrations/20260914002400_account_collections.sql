-- Collections saved to an account (Phase 3, slice 4). One entry per owned printing, or per card when only the name
-- matched, visible to its owner only.
--
-- Uploads run in batches inside an import. Batches are staged, and nothing reaches the collection until the import
-- commits, so an interrupted upload changes nothing and can simply start over. At commit, "merge" adds to what's there
-- and "replace" swaps the whole collection.
--
-- Signed-in users can read and delete their own entries directly. Every write goes through the functions below, which
-- run as the table owner, always act on auth.uid()'s rows, and apply the size limits in app_config.collections.

insert into public.app_config (key, value, is_public)
values ('collections', '{"maxImportRows": 50000, "maxEntries": 100000, "maxOpenImports": 3}'::jsonb, false)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- A 50,000-line import takes 25 matching calls and 25 saving calls.
update public.app_config
set value = value || '{"collection": {"limit": 120, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

create table public.collection_imports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_app text not null check (source_app in ('manabox', 'moxfield', 'tcgplayer', 'generic_csv', 'generic_json', 'text')),
  mode text not null check (mode in ('replace', 'merge')),
  status text not null default 'open' check (status in ('open', 'committed')),
  rows_total integer not null default 0,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index collection_imports_user on public.collection_imports (user_id, status, id desc);

-- Rows waiting for their import to commit.
create table public.collection_import_rows (
  import_id bigint not null references public.collection_imports (id) on delete cascade,
  card_id integer not null,
  printing_id uuid,
  finish text not null check (finish in ('nonfoil', 'foil', 'etched')),
  condition text not null check (char_length(condition) between 1 and 32),
  lang text not null check (char_length(lang) between 1 and 8),
  quantity integer not null check (quantity between 1 and 100000)
);
create index collection_import_rows_import on public.collection_import_rows (import_id);

create table public.collection_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id integer not null references public.cards (id),
  printing_id uuid references public.printings (id),
  finish text not null check (finish in ('nonfoil', 'foil', 'etched')),
  condition text not null check (char_length(condition) between 1 and 32),
  lang text not null check (char_length(lang) between 1 and 8),
  quantity integer not null check (quantity between 1 and 100000),
  import_id bigint references public.collection_imports (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- One entry per card, printing (or none), finish, condition and language.
create unique index collection_items_entry on public.collection_items (
  user_id, card_id, coalesce(printing_id, '00000000-0000-0000-0000-000000000000'::uuid), finish, condition, lang
);

-- Copies per card, whatever the printing. security_invoker keeps the items' row-level security.
create view public.collection_cards with (security_invoker = true) as
select user_id, card_id, sum(quantity)::integer as quantity
from public.collection_items
group by user_id, card_id;

alter table public.collection_imports enable row level security;
alter table public.collection_import_rows enable row level security;
alter table public.collection_items enable row level security;

create policy own_collection_imports_read on public.collection_imports
  for select to authenticated using (user_id = (select auth.uid()));
create policy own_collection_items_read on public.collection_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy own_collection_items_delete on public.collection_items
  for delete to authenticated using (user_id = (select auth.uid()));
-- collection_import_rows has no policies: only the functions below touch it.

revoke all on public.collection_imports, public.collection_import_rows, public.collection_items, public.collection_cards from anon, authenticated;
grant select on public.collection_imports to authenticated;
grant select, delete on public.collection_items to authenticated;
grant select on public.collection_cards to authenticated;
grant all on public.collection_imports, public.collection_import_rows, public.collection_items, public.collection_cards to service_role;

-- Opens an import for the caller. Keeps at most maxOpenImports open (older ones are dropped) and drops any left open
-- for over an hour, so abandoned uploads don't pile up staged rows.
create function public.start_collection_import(p_source_app text, p_mode text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  keep_open integer := greatest(coalesce((select (value ->> 'maxOpenImports')::integer from public.app_config where key = 'collections'), 3) - 1, 0);
  new_id bigint;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  delete from public.collection_imports i
  where i.user_id = uid
    and i.status = 'open'
    and (
      i.created_at < now() - interval '1 hour'
      or i.id not in (
        select o.id from public.collection_imports o where o.user_id = uid and o.status = 'open' order by o.id desc limit keep_open
      )
    );

  insert into public.collection_imports (user_id, source_app, mode) values (uid, p_source_app, p_mode) returning id into new_id;
  return new_id;
end;
$$;

-- Stages a batch of up to 2,000 resolved rows ({cardId, printingId, finish, condition, lang, quantity}) in the caller's
-- open import. Returns the number of rows staged.
create function public.save_collection_rows(p_import_id bigint, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_rows integer := coalesce((select (value ->> 'maxImportRows')::integer from public.app_config where key = 'collections'), 50000);
  batch_size integer := jsonb_array_length(p_rows);
  import_rows integer;
  staged integer;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  if batch_size > 2000 then
    raise exception 'COLLECTION_TOO_LARGE';
  end if;

  -- Also locks the import, so its batches and its commit run one at a time.
  update public.collection_imports i
  set rows_total = i.rows_total + batch_size
  where i.id = p_import_id and i.user_id = uid and i.status = 'open'
  returning i.rows_total into import_rows;
  if import_rows is null then
    raise exception 'IMPORT_NOT_OPEN';
  end if;
  if import_rows > max_rows then
    raise exception 'COLLECTION_TOO_LARGE';
  end if;

  insert into public.collection_import_rows (import_id, card_id, printing_id, finish, condition, lang, quantity)
  select
    p_import_id,
    r."cardId",
    r."printingId",
    coalesce(nullif(r.finish, ''), 'nonfoil'),
    coalesce(nullif(trim(r.condition), ''), 'NM'),
    lower(coalesce(nullif(trim(r.lang), ''), 'en')),
    least(r.quantity, 100000)
  from jsonb_to_recordset(p_rows) as r("cardId" integer, "printingId" uuid, finish text, condition text, lang text, quantity integer)
  where r."cardId" is not null and r.quantity > 0;
  get diagnostics staged = row_count;
  return staged;
end;
$$;

-- Totals for the caller's collection.
create function public.my_collection_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'uniqueCards', count(distinct ci.card_id),
    'totalQuantity', coalesce(sum(ci.quantity), 0),
    'updatedAt', coalesce(max(ci.updated_at), now())
  )
  from public.collection_items ci
  where ci.user_id = auth.uid()
$$;

-- Applies the caller's import in one transaction: replace swaps the whole collection, merge adds quantities. Repeats
-- of the same entry are summed, unknown cards are skipped, and a printing id that doesn't belong to its card is dropped
-- (the card still counts). Returns the collection totals.
create function public.commit_collection_import(p_import_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  max_entries integer := coalesce((select (value ->> 'maxEntries')::integer from public.app_config where key = 'collections'), 100000);
  import_mode text;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  update public.collection_imports i
  set status = 'committed', committed_at = now()
  where i.id = p_import_id and i.user_id = uid and i.status = 'open'
  returning i.mode into import_mode;
  if import_mode is null then
    raise exception 'IMPORT_NOT_OPEN';
  end if;

  if import_mode = 'replace' then
    delete from public.collection_items ci where ci.user_id = uid;
  end if;

  insert into public.collection_items as ci (user_id, card_id, printing_id, finish, condition, lang, quantity, import_id)
  select uid, r.card_id, p.id, r.finish, r.condition, r.lang, least(sum(r.quantity), 100000)::integer, p_import_id
  from public.collection_import_rows r
  join public.cards c on c.id = r.card_id
  left join public.printings p on p.id = r.printing_id and p.card_id = r.card_id
  where r.import_id = p_import_id
  group by r.card_id, p.id, r.finish, r.condition, r.lang
  on conflict (user_id, card_id, coalesce(printing_id, '00000000-0000-0000-0000-000000000000'::uuid), finish, condition, lang)
  do update set quantity = least(ci.quantity + excluded.quantity, 100000), import_id = excluded.import_id, updated_at = now();

  if (select count(*) from public.collection_items ci where ci.user_id = uid) > max_entries then
    raise exception 'COLLECTION_TOO_LARGE';
  end if;

  delete from public.collection_import_rows r where r.import_id = p_import_id;
  return public.my_collection_totals();
end;
$$;

-- Distinct owned card ids as one array, so owned-only recommendations aren't cut off by the API's row limit.
create function public.my_owned_card_ids()
returns integer[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct ci.card_id), '{}') from public.collection_items ci where ci.user_id = auth.uid()
$$;

revoke execute on function public.start_collection_import(text, text) from public, anon;
revoke execute on function public.save_collection_rows(bigint, jsonb) from public, anon;
revoke execute on function public.commit_collection_import(bigint) from public, anon;
revoke execute on function public.my_collection_totals() from public, anon;
revoke execute on function public.my_owned_card_ids() from public, anon;
grant execute on function public.start_collection_import(text, text) to authenticated, service_role;
grant execute on function public.save_collection_rows(bigint, jsonb) to authenticated, service_role;
grant execute on function public.commit_collection_import(bigint) to authenticated, service_role;
grant execute on function public.my_collection_totals() to authenticated, service_role;
grant execute on function public.my_owned_card_ids() to authenticated, service_role;
