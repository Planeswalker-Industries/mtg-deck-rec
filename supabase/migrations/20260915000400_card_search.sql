-- Card-name search for pickers, starting with the card rater's commander picker. Names that start with the query come
-- first, then names containing it (more-played commanders first within each), then close typos (trigram similarity and
-- word similarity, card_names_trgm index). The app normalizes the query the same way card_names.name_normalized is built.
create function public.search_cards(p_query text, p_commander_only boolean default false, p_limit integer default 8)
returns table (card_id integer)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select
      p_query as raw,
      replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') as pattern
  ),
  matches as (
    select
      cn.card_id,
      bool_or(cn.name_normalized like q.pattern || '%') as prefix,
      bool_or(cn.name_normalized like '%' || q.pattern || '%') as contains,
      max(greatest(extensions.similarity(cn.name_normalized, q.raw), extensions.word_similarity(q.raw, cn.name_normalized))) as score
    from q
    join public.card_names cn
      on cn.name_normalized like q.pattern || '%'
      -- Two letters match too much of the catalog to look inside names cheaply, so they only match name starts.
      or (
        length(q.raw) >= 3
        and (
          cn.name_normalized like '%' || q.pattern || '%'
          or cn.name_normalized operator(extensions.%) q.raw
          or q.raw operator(extensions.<%) cn.name_normalized
        )
      )
    join public.cards c on c.id = cn.card_id and c.deleted_at is null
    where length(q.raw) >= 2
      and (not p_commander_only or (c.can_be_commander and c.legal_commander = 'legal'))
    group by cn.card_id
  )
  select m.card_id
  from matches m
  join public.cards c on c.id = m.card_id
  left join public.commander_keys k on k.commander_1 = c.id and k.commander_2 is null
  left join public.commander_stats s on s.commander_key_id = k.id
  order by
    m.prefix desc,
    m.contains desc,
    case when m.contains then coalesce(s.deck_count, 0) else 0 end desc,
    m.score desc,
    coalesce(s.deck_count, 0) desc,
    c.name
  limit least(greatest(coalesce(p_limit, 8), 1), 20)
$$;

revoke execute on function public.search_cards(text, boolean, integer) from public;
grant execute on function public.search_cards(text, boolean, integer) to anon, authenticated, service_role;

-- Typing searches as the player types (debounced in the app).
update public.app_config
set value = value || '{"search": {"limit": 120, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';
