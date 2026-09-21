-- Collection matching ran every identifier branch for every row, then threw away all but the most specific match.
-- A 1,000-row ManaBox export whose rows all matched on Scryfall id still paid for the TCGplayer, set + collector
-- number and name branches: 9.3 s warm on hosted, against the 3 s `anon` statement timeout, so the import failed
-- with "canceling statement due to statement timeout".
--
-- Two changes, neither of which changes what a row resolves to:
--
-- 1. Each branch now drives only on the rows no earlier branch matched, and is skipped when the row does not carry
--    that identifier. The branches were already ranked by `distinct on (row_no) order by priority`, so a row matched
--    at priority 1 could never win at priority 4 — the work was wasted, not load-bearing. Non-recursive CTEs that
--    are referenced twice are materialized, so each branch is computed once and its remainder feeds the next.
--
-- 2. `printings_set_cn` becomes a covering index. The set + collector number branch is the expensive one even when
--    it does run: measured on hosted, 1,000 rows fanned out to 8,032 printings (one per paper language) and 12,082
--    buffers, because every entry needed a heap visit for `lang`, `card_id` and `deleted_at`. With those included
--    and the dead rows excluded by the predicate, the branch is an index-only scan.
--
--    `lang` moves from a key column to an INCLUDE column: it is a filter on eight entries per key, never a search
--    bound, and keeping it in the key would only make the lookup that follows it in the sort order. The old index
--    is dropped rather than kept beside the new one — the printings sync merges on the primary key, so these two
--    branches are its only reader (14,437 scans, 21 MB).
--
-- Every branch that picks one printing out of several now ends its ordering on `printings.id`. The card was never in
-- doubt, but which printing was recorded came down to scan order: a set and collector number with no English and no
-- named language left a tie, and the same import run twice could store a different language. Two rows of a 3,000-row
-- check did exactly that.

create index printings_set_cn_cover
  on public.printings (set_code, collector_number)
  include (lang, card_id, id, finishes)
  where deleted_at is null;

drop index public.printings_set_cn;

-- An index-only scan reads the heap anyway for any page the visibility map does not mark all-visible, so the covering
-- index is only worth its 51 MB while `printings` stays vacuumed. Measured locally on the set + collector number
-- shape, 1,000 rows: 8,126 heap fetches and 11,246 buffers before a vacuum, 0 and 3,089 after. The printings sync
-- writes prices daily, which clears those bits again, and the stock scale factor would not vacuum a 525k-row table
-- until 105k rows were dead. 0.05 brings that to about 26k.
alter table public.printings set (autovacuum_vacuum_scale_factor = 0.05);

-- Matches collection rows to a printing (and its card), trying the most specific identifier first: Scryfall id, then
-- TCGplayer id, then set + collector number + language (when the row names a language), then set + collector number
-- (preferring the row's language, then English), then the card name alone (normalized by the app; exact aliases only).
-- Rows arrive as jsonb objects: rowNo, scryfallId, tcgplayerId, setCode, collectorNumber, lang, nameNormalized.
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

  -- 4. Set and collector number alone, across every language: the row's own language first, then English.
  by_set_cn as (
    select distinct on (i.row_no) i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes
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
