-- People type card names without punctuation ("kodamas reach", "chulane teller of tales").
-- A punctuation- and space-free key catches those before falling back to trigram typo matching.

alter table public.card_names
  add column name_loose text generated always as (regexp_replace(name_normalized, '[^a-z0-9]+', '', 'g')) stored;

create index card_names_loose on public.card_names (name_loose);

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
  unmatched_exact as (
    select input from inputs
    except
    select input from exact
  ),
  -- Same name with punctuation and spacing ignored.
  loose as (
    select
      u.input,
      cn.card_id,
      'loose'::text as via,
      0.99::real as score,
      row_number() over (
        partition by u.input
        order by
          case cn.kind when 'full' then 0 when 'face' then 1 else 2 end,
          (c.legal_commander = 'legal') desc,
          c.is_digital_only,
          c.released_at desc nulls last
      )::integer as rank
    from unmatched_exact u
    join public.card_names cn on cn.name_loose = regexp_replace(u.input, '[^a-z0-9]+', '', 'g')
    join public.cards c on c.id = cn.card_id and c.deleted_at is null
  ),
  unmatched as (
    select input from unmatched_exact
    except
    select input from loose
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
  select input, card_id, via, score, rank from loose where rank <= 3
  union all
  select input, card_id, via, score, rank from fuzzy
$$;
