-- Collection imports: matching exported rows to printings and cards, and a kill switch per share-link source.

-- Share-link imports fetch a deck or collection link a user pasted. If a site answers with bot protection (a Cloudflare
-- challenge, or a 403/409 outside its usual format), the app switches that source off here and stops fetching from it.
-- Only the service role changes a source; turning one back on is a deliberate, manual step.
create table public.share_import_sources (
  source text primary key,
  enabled boolean not null default true,
  disabled_at timestamptz,
  disabled_reason text,
  last_blocked_status integer,
  updated_at timestamptz not null default now()
);

insert into public.share_import_sources (source) values ('archidekt'), ('manabox'), ('moxfield'), ('tcgplayer');

alter table public.share_import_sources enable row level security;
create policy public_read on public.share_import_sources for select to anon, authenticated using (true);
grant select on public.share_import_sources to anon, authenticated;
grant all on public.share_import_sources to service_role;

-- Collection matching runs up to 2,000 rows per call; a 50k-row collection takes 25 calls.
update public.app_config
set value = value || '{"collection": {"limit": 40, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

-- Changes whenever a catalog or printings sync succeeds. Clients store it with a resolved collection; a different value
-- later means stored card and printing ids should be re-resolved.
create function public.catalog_epoch()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(id), 0)::text
  from public.sync_runs
  where job in ('scryfall_catalog', 'scryfall_printings') and status = 'succeeded'
$$;

-- Matches collection rows to a printing (and its card), trying the most specific identifier first: Scryfall id, then
-- TCGplayer id, then set + collector number + language (when the row names a language), then set + collector number
-- (preferring the row's language, then English), then the card name alone (normalized by the app; exact aliases only).
-- Rows arrive as jsonb objects: rowNo, scryfallId, tcgplayerId, setCode, collectorNumber, lang, nameNormalized.
create function public.resolve_collection_rows(p_rows jsonb)
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
  names as (
    select n.input, n.card_id
    from public.resolve_card_names(array(select distinct i.name_normalized from input i where i.name_normalized is not null)) n
    where n.rank = 1 and (n.via <> 'fuzzy' or n.score >= 0.99)
  ),
  matches as (
    select i.row_no, p.card_id, p.id as printing_id, p.lang, p.finishes, 'scryfall_id' as via, 1 as priority
    from input i
    join public.printings p on p.id = i.scryfall_id and p.deleted_at is null

    -- DISTINCT ON branches need parentheses so their ORDER BY stays inside the branch.
    union all
    (
      select distinct on (i.row_no) i.row_no, p.card_id, p.id, p.lang, p.finishes, 'tcgplayer_id', 2
      from input i
      join public.printings p on (p.tcgplayer_id = i.tcgplayer_id or p.tcgplayer_etched_id = i.tcgplayer_id) and p.deleted_at is null
      order by i.row_no, (p.lang = 'en') desc
    )

    union all
    select i.row_no, p.card_id, p.id, p.lang, p.finishes, 'set_cn_lang', 3
    from input i
    join public.printings p
      on p.set_code = i.set_code and p.collector_number = i.collector_number and p.lang = i.lang and p.deleted_at is null

    union all
    (
      select distinct on (i.row_no) i.row_no, p.card_id, p.id, p.lang, p.finishes, 'set_cn', 4
      from input i
      join public.printings p on p.set_code = i.set_code and p.collector_number = i.collector_number and p.deleted_at is null
      order by i.row_no, (p.lang = i.lang) desc nulls last, (p.lang = 'en') desc
    )

    union all
    select i.row_no, n.card_id, null::uuid, i.lang, null::text[], 'name_only', 5
    from input i
    join names n on n.input = i.name_normalized
  )
  select distinct on (m.row_no) m.row_no, m.card_id, m.printing_id, m.lang, m.finishes, m.via
  from matches m
  order by m.row_no, m.priority
$$;

revoke execute on function public.catalog_epoch() from public;
revoke execute on function public.resolve_collection_rows(jsonb) from public;
grant execute on function public.catalog_epoch() to anon, authenticated, service_role;
grant execute on function public.resolve_collection_rows(jsonb) to anon, authenticated, service_role;
