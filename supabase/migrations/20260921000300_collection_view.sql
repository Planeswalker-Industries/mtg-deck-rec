-- The collection view (/collection): what a player owns, filtered by name, tag, colour and set.
--
-- 1. public.sets: name, type and release date per set code, so the view can offer "major releases" by name, newest
--    first. Filled by sync:printings from the same All Cards file (every printing carries its set's name, type and
--    date), so there is no second download. Empty until that sync next runs.
-- 2. resolve_collection_rows also returns the matched printing's set code. A collection kept in the browser stores it
--    per row, so the view can filter by set without asking the server about thousands of printing ids.
-- 3. my_collection_entries(): the signed-in user's collection folded to one entry per card (total copies and the set
--    codes of the printings they own), as one jsonb value so PostgREST's 1,000-row cap never truncates it.

create table public.sets (
  code text primary key, -- upper case, as printings.set_code
  name text not null,
  set_type text not null,
  released_at date,
  updated_at timestamptz not null default now()
);

alter table public.sets enable row level security;
create policy public_read on public.sets for select to anon, authenticated using (true);
grant select on public.sets to anon, authenticated;
grant all on public.sets to service_role;

-- The return type gains a column, which `create or replace` can't change.
drop function public.resolve_collection_rows(jsonb);

-- Unchanged from 20260921000200 except that every branch also returns the printing's set code (null for a match by
-- name alone).
create function public.resolve_collection_rows(p_rows jsonb)
returns table (row_no integer, card_id integer, printing_id uuid, lang text, finishes text[], via text, set_code text)
language sql
stable
security definer
set search_path = ''
as $$
  with input as (
    select
      r."rowNo" as row_no,
      case when r."scryfallId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then r."scryfallId"::uuid end as scryfall_id,
      r."tcgplayerId" as tcgplayer_id,
      upper(nullif(trim(r."setCode"), '')) as set_code,
      nullif(trim(r."collectorNumber"), '') as collector_number,
      lower(nullif(trim(r."lang"), '')) as lang,
      nullif(r."nameNormalized", '') as name_normalized
    from jsonb_to_recordset(p_rows) as r(
      "rowNo" integer, "scryfallId" text, "tcgplayerId" integer, "setCode" text, "collectorNumber" text, "lang" text, "nameNormalized" text
    )
  ),

  -- 1. Scryfall id. One printing or none, so no tie to break.
  by_scryfall_id as (
    select i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes, p.set_code
    from input i
    join public.printings p on p.id = i.scryfall_id and p.deleted_at is null
    where i.scryfall_id is not null
  ),
  after_scryfall_id as (
    select i.* from input i
    where not exists (select 1 from by_scryfall_id m where m.row_no = i.row_no)
  ),

  -- 2. TCGplayer id, either the normal or the etched one. English wins when both languages carry the id.
  by_tcgplayer_id as (
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes, p.set_code
    from after_scryfall_id i
    join public.printings p
      on (p.tcgplayer_id = i.tcgplayer_id or p.tcgplayer_etched_id = i.tcgplayer_id) and p.deleted_at is null
    where i.tcgplayer_id is not null
    order by i.row_no, (p.lang = 'en') desc, p.id
  ),
  after_tcgplayer_id as (
    select i.* from after_scryfall_id i
    where not exists (select 1 from by_tcgplayer_id m where m.row_no = i.row_no)
  ),

  -- 3. Set, collector number and the language the row named. `distinct on` only breaks a tie between printings that
  -- agree on all three, which the catalog does not have; it keeps one row per input row either way.
  by_set_cn_lang as (
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes, p.set_code
    from after_tcgplayer_id i
    join public.printings p
      on p.set_code = i.set_code and p.collector_number = i.collector_number and p.lang = i.lang and p.deleted_at is null
    where i.set_code is not null and i.collector_number is not null and i.lang is not null
    order by i.row_no, p.id
  ),
  after_set_cn_lang as (
    select i.* from after_tcgplayer_id i
    where not exists (select 1 from by_set_cn_lang m where m.row_no = i.row_no)
  ),

  -- 4. Set and collector number alone, the row's own language first, then English. Printings are English only
  -- since 20260921000200, so the language returned is the row's when it named one.
  by_set_cn as (
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, coalesce(i.lang, p.lang) as lang, p.finishes, p.set_code
    from after_set_cn_lang i
    join public.printings p
      on p.set_code = i.set_code and p.collector_number = i.collector_number and p.deleted_at is null
    where i.set_code is not null and i.collector_number is not null
    order by i.row_no, (p.lang = i.lang) desc nulls last, (p.lang = 'en') desc, p.id
  ),
  after_set_cn as (
    select i.* from after_set_cn_lang i
    where not exists (select 1 from by_set_cn m where m.row_no = i.row_no)
  ),

  -- 5. The name alone. Only the rows nothing else matched are looked up, which also keeps the trigram fallback
  -- inside `resolve_card_names` off names that were already resolved to an exact printing.
  names as (
    select n.input, n.card_id
    from public.resolve_card_names(array(select distinct i.name_normalized from after_set_cn i where i.name_normalized is not null)) n
    where n.rank = 1 and (n.via <> 'fuzzy' or n.score >= 0.99)
  ),
  by_name as (
    select distinct on (i.row_no) i.row_no, n.card_id, null::uuid as printing_id, i.lang, null::text[] as finishes, null::text as set_code
    from after_set_cn i
    join names n on n.input = i.name_normalized
    order by i.row_no, n.card_id
  )

  select row_no, card_id, printing_id, lang, finishes, 'scryfall_id'::text as via, set_code from by_scryfall_id
  union all
  select row_no, card_id, printing_id, lang, finishes, 'tcgplayer_id', set_code from by_tcgplayer_id
  union all
  select row_no, card_id, printing_id, lang, finishes, 'set_cn_lang', set_code from by_set_cn_lang
  union all
  select row_no, card_id, printing_id, lang, finishes, 'set_cn', set_code from by_set_cn
  union all
  select row_no, card_id, printing_id, lang, finishes, 'name_only', set_code from by_name
$$;

revoke execute on function public.resolve_collection_rows(jsonb) from public;
grant execute on function public.resolve_collection_rows(jsonb) to anon, authenticated, service_role;

-- One entry per card: {cardId, quantity, setCodes}. Acts on auth.uid() only; signed out, it is an empty array.
create function public.my_collection_entries()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('cardId', e.card_id, 'quantity', e.quantity, 'setCodes', e.set_codes) order by e.card_id),
    '[]'::jsonb
  )
  from (
    select
      ci.card_id,
      sum(ci.quantity)::integer as quantity,
      coalesce(array_agg(distinct p.set_code) filter (where p.set_code is not null), '{}') as set_codes
    from public.collection_items ci
    left join public.printings p on p.id = ci.printing_id
    where ci.user_id = (select auth.uid())
    group by ci.card_id
  ) e
$$;

revoke execute on function public.my_collection_entries() from public, anon;
grant execute on function public.my_collection_entries() to authenticated, service_role;
