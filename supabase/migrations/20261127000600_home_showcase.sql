-- The homepage's Commanders & Decks section (T109). One read returns both of its lists:
--
-- Popular: the commander keys the most visitors built or tuned over the last p_days days, counted as distinct voter
-- keys over `shown` rec_events in any mode, ties by corpus deck count then slug, topped up to three from the corpus's
-- most played keys. A list's commander ids come in no promised order, so a pair is matched on its sorted ids; `{}`
-- and ids that name no key count for nothing.
--
-- Latest: the newest public 100-card decks, one per commander (a pair in either column order is one commander), newest
-- first. A deck with no commander is skipped. Its commander key's slug comes along when the corpus has one.
--
-- Entries whose commander cards left the catalog are skipped. The result holds counts, key slugs, commander card ids
-- and the codes of decks that already have public pages: never voter keys, user ids, deck names or private decks.

create function public.home_showcase(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_size constant integer := 3; -- plates per column on the homepage
  c_deck_cards constant integer := 100; -- a complete Commander deck
  c_default_days constant integer := 30;
  c_max_days constant integer := 90; -- keeps the visitor count to a scan of recent rows
  v_days integer := greatest(1, least(c_max_days, coalesce(p_days, c_default_days)));
  v_popular jsonb;
  v_latest jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  r record;
begin
  with app as (
    select k.id, count(distinct e.voter_key) as visitors
    from public.rec_events e
    join public.commander_keys k
      on k.commander_1 = least(e.commander_ids[1], e.commander_ids[2])
     and coalesce(k.commander_2, 0) = coalesce(
           nullif(greatest(e.commander_ids[1], e.commander_ids[2]), least(e.commander_ids[1], e.commander_ids[2])), 0)
    where e.kind = 'shown'
      and e.created_at > now() - make_interval(days => v_days)
    group by k.id
  ),
  ranked as (
    select k.slug, k.commander_1, k.commander_2, coalesce(a.visitors, 0) as visitors, coalesce(s.deck_count, 0) as deck_count
    from public.commander_keys k
    left join app a on a.id = k.id
    left join public.commander_stats s on s.commander_key_id = k.id
    where (a.id is not null or s.deck_count > 0)
      and exists (select 1 from public.cards c where c.id = k.commander_1 and c.deleted_at is null)
      and (k.commander_2 is null
           or exists (select 1 from public.cards c where c.id = k.commander_2 and c.deleted_at is null))
    order by visitors desc, deck_count desc, k.slug
    limit c_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', slug, 'commander1', commander_1, 'commander2', commander_2,
           'visitors', visitors, 'deckCount', deck_count
         ) order by visitors desc, deck_count desc, slug), '[]'::jsonb)
  into v_popular
  from ranked;

  -- Newest first, stopping at the third commander, so the read stays short however many decks are saved.
  for r in
    select d.code, d.created_at, p.c1, p.c2
    from public.decks d
    cross join lateral (
      select least(d.commander_1, d.commander_2) as c1,
             nullif(greatest(d.commander_1, d.commander_2), least(d.commander_1, d.commander_2)) as c2
    ) p
    where d.is_public
      and d.card_count = c_deck_cards
      and p.c1 is not null
    order by d.created_at desc, d.code
  loop
    continue when (r.c1 || ':' || coalesce(r.c2, 0)) = any (v_seen);
    continue when not exists (select 1 from public.cards c where c.id = r.c1 and c.deleted_at is null)
      or (r.c2 is not null and not exists (select 1 from public.cards c where c.id = r.c2 and c.deleted_at is null));
    v_seen := v_seen || (r.c1 || ':' || coalesce(r.c2, 0));
    v_latest := v_latest || jsonb_build_array(jsonb_build_object(
      'code', r.code,
      'slug', (select k.slug from public.commander_keys k
               where k.commander_1 = r.c1 and coalesce(k.commander_2, 0) = coalesce(r.c2, 0)),
      'commander1', r.c1,
      'commander2', r.c2,
      'createdAt', r.created_at
    ));
    exit when cardinality(v_seen) >= c_size;
  end loop;

  return jsonb_build_object('popular', v_popular, 'latest', v_latest);
end;
$$;

comment on function public.home_showcase(integer) is
  'Homepage Commanders & Decks. Reads rec_events for counts only (distinct visitors per commander key); returns no voter keys, user ids, deck names or private decks.';

revoke all on function public.home_showcase(integer) from public;
grant execute on function public.home_showcase(integer) to anon, authenticated;
