-- Collection mode (T059; docs/roadmap/scoring-design.md, "Availability" and "Mode A").
--
-- * decks.is_built: the player has put the deck together, so its cards are taken. Suggestions for their other decks
--   tag a card whose every copy sits in a built deck as a conflict. A list still being brewed holds nothing. Set only
--   through set_deck_built, which doesn't touch updated_at: being built changes nothing the corpus reads.
-- * my_card_availability(p_deck_id): the caller's copies per card and the copies each of their other built decks
--   holds, as one jsonb value (no row cap). The deck being improved is left out: its copies are its own.
-- * serving_add_pool with p_owned returns the colours' pool too, beside the commander's, so a collection's cards no
--   deck of the commander ran are still scored (by the commander's deck months, like every card without a row).
-- * app_config.scoring.collection: the buy list's margin, price floor and length (starting values, which the
--   evaluation retunes).

alter table public.decks add column if not exists is_built boolean not null default false;
comment on column public.decks.is_built is
  'The player has put this deck together: its cards are taken (T059). Never read by the corpus.';

create or replace function public.set_deck_built(p_deck_id uuid, p_is_built boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  hit uuid;
begin
  if uid is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  update public.decks d set is_built = p_is_built
  where d.id = p_deck_id and d.user_id = uid
  returning d.id into hit;
  if hit is null then
    raise exception 'DECK_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.set_deck_built(uuid, boolean) from public;
grant execute on function public.set_deck_built(uuid, boolean) to authenticated, service_role;

-- Security invoker: row-level security keeps it to the caller's own collection and decks, and auth.uid() says whose.
create or replace function public.my_card_availability(p_deck_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'owned', coalesce((
      select jsonb_agg(jsonb_build_array(o.card_id, o.copies) order by o.card_id)
      from (
        select ci.card_id, sum(ci.quantity)::integer as copies
        from public.collection_items ci
        where ci.user_id = auth.uid()
        group by ci.card_id
        having sum(ci.quantity) > 0
      ) o
    ), '[]'::jsonb),
    'built', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', d.id,
                 'code', d.code,
                 'name', d.name,
                 'cards', coalesce((
                   select jsonb_agg(jsonb_build_array(dc.card_id, dc.copies) order by dc.card_id)
                   from (
                     select c.card_id, sum(c.quantity)::integer as copies
                     from public.deck_cards c
                     where c.deck_id = d.id
                     group by c.card_id
                   ) dc
                 ), '[]'::jsonb)
               )
               order by d.name, d.id
             )
      from public.decks d
      where d.user_id = auth.uid()
        and d.is_built
        and d.id is distinct from p_deck_id
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.my_card_availability(uuid) from public, anon;
grant execute on function public.my_card_availability(uuid) to authenticated, service_role;

update public.app_config
   set value = value || '{"collection": {"buyMargin": 0.05, "priceFloorUsd": 0.25, "buyListSize": 10}}'::jsonb,
       updated_at = now()
 where key = 'scoring'
   and not value ? 'collection';

-- serving_add_pool: with p_owned, the colours' pool as well as the commander's.
create or replace function public.serving_add_pool(
  p_commander_ids integer[],
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 400,
  p_mode text default 'adds'
)
returns table (pool text, "position" integer, card public.serving_card)
language sql
stable
security definer
set search_path = ''
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  t as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           coalesce((select bit_or(c.color_identity) from public.cards c where c.id = any (m.ids) and c.deleted_at is null), 0)::smallint as mask,
           s.commander_1 is not null as known,
           coalesce(case when p_mode = 'decks' then s.has_sources else s.use_commander end, false) as draw
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
  ),
  pools as materialized (
    select 'commander'::text as pool, p.card_id, p."position"
    from t
    cross join lateral public.serving_commander_pool(t.c1, t.c2, t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where t.known and t.draw
    union all
    select 'partners'::text, p.card_id, p."position"
    from t
    cross join lateral public.serving_partner_pool(t.c1, t.c2, t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where not t.known and t.n = 2
    union all
    select 'baseline'::text, p.card_id, p."position"
    from t
    cross join lateral public.serving_baseline_pool(t.mask, p_exclude, p_allow_game_changers, p_owned, p_limit) p
    where not (t.known and t.draw) or p_owned is not null
  )
  select p.pool, p."position", r
  from pools p
  join public.serving_cards(p_commander_ids, array(select distinct card_id from pools)) r on r.card_id = p.card_id
  order by p.pool, p."position"
$$;
