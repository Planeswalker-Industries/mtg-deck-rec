-- Decklist name resolution. Inputs are names already normalized in TypeScript (@mtg/core/parse normalizeName).

create or replace function public.resolve_card_names(p_names text[])
returns table (input text, card_id integer, via text, score real, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  with inputs as (
    select distinct unnest(p_names) as input
  ),
  -- Exact alias hits. When several cards share a name, prefer the full name, then Commander-legal,
  -- then paper over digital-only, then the most recent release.
  exact as (
    select
      i.input,
      cn.card_id,
      cn.kind as via,
      1.0::real as score,
      row_number() over (
        partition by i.input
        order by
          case cn.kind when 'full' then 0 when 'face' then 1 when 'flavor' then 2 when 'printed' then 3 else 4 end,
          (c.legal_commander = 'legal') desc,
          c.is_digital_only,
          c.released_at desc nulls last
      )::integer as rank
    from inputs i
    join public.card_names cn on cn.name_normalized = i.input
    join public.cards c on c.id = cn.card_id and c.deleted_at is null
  ),
  unmatched as (
    select input from inputs
    except
    select input from exact
  ),
  -- Typos and partial names: best three trigram matches (uses the card_names_trgm GIN index).
  fuzzy as (
    select u.input, m.card_id, 'fuzzy'::text as via, m.score, m.rank
    from unmatched u
    cross join lateral (
      select
        cn.card_id,
        extensions.similarity(cn.name_normalized, u.input)::real as score,
        row_number() over (order by extensions.similarity(cn.name_normalized, u.input) desc)::integer as rank
      from public.card_names cn
      join public.cards c on c.id = cn.card_id and c.deleted_at is null
      where cn.name_normalized operator(extensions.%) u.input
      order by score desc
      limit 3
    ) m
  )
  select input, card_id, via, score, rank from exact where rank <= 3
  union all
  select input, card_id, via, score, rank from fuzzy
$$;

revoke execute on function public.resolve_card_names(text[]) from public;
grant execute on function public.resolve_card_names(text[]) to anon, authenticated, service_role;
