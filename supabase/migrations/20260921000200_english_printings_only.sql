-- English printings only. Other languages were ~81% of public.printings (425k of 525k rows locally, ~120 MB with
-- indexes) on a 500 MB free tier, and nothing needs them: decks and recommendations are oracle-level, card images and
-- text come from `cards`, and every card with a printing has an English one. sync:printings now skips non-English
-- printings, so this removes the ones already stored.
--
-- Collections keep what the owner told us. A collection row pointing at a non-English printing moves to the English
-- printing with the same set and collector number (or to no printing, when there is none), and its own `lang`
-- column is left alone. resolve_collection_rows is redefined below so new imports keep the row's language the same way.
--
-- The delete leaves dead row versions until vacuum. To give the space back on disk, run by hand afterwards (it can't
-- run inside a migration's transaction):  vacuum full public.printings;

-- The English printing a non-English one maps to, when there is one.
create temp table printing_remap as
select distinct on (x.id) x.id as old_id, e.id as new_id
from public.printings x
left join public.printings e
  on e.set_code = x.set_code and e.collector_number = x.collector_number and e.lang = 'en'
where x.lang <> 'en'
order by x.id, e.deleted_at is not null, e.id;

-- Staged import rows: no uniqueness to respect.
update public.collection_import_rows r
set printing_id = m.new_id
from printing_remap m
where r.printing_id = m.old_id;

-- Collection items: one entry per (user, card, printing, finish, condition, lang), so an item whose new printing
-- matches an entry the user already has is folded into it instead.
with moving as (
  select ci.id, ci.user_id, ci.card_id, m.new_id, ci.finish, ci.condition, ci.lang, ci.quantity
  from public.collection_items ci
  join printing_remap m on m.old_id = ci.printing_id
),
folded as (
  update public.collection_items t
  set quantity = least(100000, t.quantity + mv.quantity), updated_at = now()
  from moving mv
  where t.id <> mv.id
    and t.user_id = mv.user_id and t.card_id = mv.card_id
    and t.printing_id is not distinct from mv.new_id
    and t.finish = mv.finish and t.condition = mv.condition and t.lang = mv.lang
  returning mv.id as folded_id
)
delete from public.collection_items ci using folded f where ci.id = f.folded_id;

update public.collection_items ci
set printing_id = m.new_id, updated_at = now()
from printing_remap m
where ci.printing_id = m.old_id;

delete from public.printings where lang <> 'en';

drop table printing_remap;

-- Unchanged from 20260920000100 except step 4, which now keeps the row's own language when it named one: the printing
-- it lands on is English now, and the owner's copy is still the language they said.
create or replace function public.resolve_collection_rows(p_rows jsonb)
returns table (row_no integer, card_id integer, printing_id uuid, lang text, finishes text[], via text)
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
    select i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes
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
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes
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
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes
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
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, coalesce(i.lang, p.lang) as lang, p.finishes
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
    select distinct on (i.row_no) i.row_no, n.card_id, null::uuid as printing_id, i.lang, null::text[] as finishes
    from after_set_cn i
    join names n on n.input = i.name_normalized
    order by i.row_no, n.card_id
  )

  select row_no, card_id, printing_id, lang, finishes, 'scryfall_id'::text as via from by_scryfall_id
  union all
  select row_no, card_id, printing_id, lang, finishes, 'tcgplayer_id' from by_tcgplayer_id
  union all
  select row_no, card_id, printing_id, lang, finishes, 'set_cn_lang' from by_set_cn_lang
  union all
  select row_no, card_id, printing_id, lang, finishes, 'set_cn' from by_set_cn
  union all
  select row_no, card_id, printing_id, lang, finishes, 'name_only' from by_name
$$;

revoke execute on function public.resolve_collection_rows(jsonb) from public;
grant execute on function public.resolve_collection_rows(jsonb) to anon, authenticated, service_role;
