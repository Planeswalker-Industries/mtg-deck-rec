-- Fixes from the review of the scoring pipeline branch (PR #139), before its release.
--
-- * record_rec_event is the server's alone (service_role): it took the caller's own visitor key, so anyone with the
--   public anon key could write events without limit, past the web app's rate limit. The server action now calls it
--   with the account from the session and the visitor key it derives from the request. Events no longer accept NULL
--   card ids (which also slipped past the one-decision-per-card index) or an oversized visitor key, and an account's
--   events are found by user_id through an index when it is deleted.
-- * serving_deck_affinity and serving_build_pool clamp what an anonymous caller can ask for (pool size, neighbours,
--   card lists) to app_config.serving_limits, since a jsonb answer escapes PostgREST's row cap.
-- * serving_deck_combos keeps every complete combo and caps only the ones a card short: a build's bracket check reads
--   the complete ones, and a combo-dense pool used to push some past the cap.
-- * serving_build_pool reads the card pairs among its cards by index (it hashed the whole card_pairs table and spilled
--   to disk on every build) and finds the basic lands by slug (a sweep of the cards heap).
-- * serving_baseline_pool matches a collection through a hashed set: `id = any (p_owned)` was checked element by
--   element for every candidate, about 0.6 s for a 20,000-card collection.
-- * app_config.scoring.eval.minCommanders: the gate gives no verdict on fewer held-out commanders.

insert into public.app_config (key, value, is_public)
values (
  'serving_limits',
  -- poolCards: the most pool cards a read returns (the app asks for 400); deckCards: the most cards a deck list may
  -- name (app_config.decks.maxCards). Pair neighbours are capped by app_config.scoring.affinity.neighbours.
  '{"poolCards": 400, "deckCards": 250}'::jsonb,
  false
)
on conflict (key) do nothing;

update public.app_config
   set value = jsonb_set(value, '{eval,minCommanders}', '200'::jsonb), updated_at = now()
 where key = 'scoring'
   and value ? 'eval'
   and not (value -> 'eval') ? 'minCommanders';

-- === Accept-rate events: the server's alone ===

drop function if exists public.record_rec_event(text, uuid, text, text, integer[], smallint, integer, integer[], smallint, text, jsonb);

-- Records one event for the account p_user_id (when signed in) or the visitor p_visitor_key, both supplied by the web
-- app's server action from the session and the request. Raises VOTER_REQUIRED or INVALID_EVENT. A list recorded again
-- (same batch) or a decision repeated writes nothing new; a changed decision replaces the old one.
create function public.record_rec_event(
  p_visitor_key text,
  p_batch_id uuid,
  p_kind text,
  p_mode text,
  p_card_ids integer[],
  p_position smallint default null,
  p_target_card_id integer default null,
  p_commander_ids integer[] default '{}',
  p_bracket smallint default null,
  p_collection text default 'none',
  p_components jsonb default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  voter text;
begin
  if p_user_id is not null then
    voter := 'u:' || p_user_id::text;
  elsif coalesce(p_visitor_key, '') <> '' and length(p_visitor_key) <= 128 then
    voter := 'v:' || p_visitor_key;
  else
    raise exception 'VOTER_REQUIRED';
  end if;

  if p_batch_id is null
     or p_kind is null or p_kind not in ('shown', 'accepted', 'declined')
     or p_mode is null or p_mode not in ('add', 'cut', 'swap', 'build')
     or coalesce(p_collection, '') not in ('none', 'only', 'first')
     or cardinality(coalesce(p_card_ids, '{}')) not between 1 and 120
     or array_position(p_card_ids, null) is not null
     or array_position(coalesce(p_commander_ids, '{}'), null) is not null
     or (p_kind <> 'shown' and (cardinality(p_card_ids) <> 1 or p_position is null or p_position not between 0 and 119))
     or (p_kind = 'shown' and p_position is not null)
     or cardinality(coalesce(p_commander_ids, '{}')) > 2
     or (p_bracket is not null and p_bracket not between 1 and 5)
     or (p_components is not null and (jsonb_typeof(p_components) <> 'object' or length(p_components::text) > 500)) then
    raise exception 'INVALID_EVENT';
  end if;

  if p_kind = 'shown' then
    insert into public.rec_events (voter_key, user_id, batch_id, kind, mode, card_ids, target_card_id, commander_ids, bracket, collection)
    values (voter, p_user_id, p_batch_id, 'shown', p_mode, p_card_ids, p_target_card_id, coalesce(p_commander_ids, '{}'), p_bracket, p_collection)
    on conflict (voter_key, batch_id) where kind = 'shown' do nothing;
  else
    insert into public.rec_events as e (
      voter_key, user_id, batch_id, kind, mode, card_ids, position, target_card_id, commander_ids, bracket, collection, components
    )
    values (
      voter, p_user_id, p_batch_id, p_kind, p_mode, p_card_ids, p_position, p_target_card_id,
      coalesce(p_commander_ids, '{}'), p_bracket, p_collection, p_components
    )
    on conflict (voter_key, batch_id, (card_ids[1])) where kind <> 'shown' do update set
      kind = excluded.kind,
      position = excluded.position,
      components = excluded.components,
      created_at = now()
    where e.kind is distinct from excluded.kind;
  end if;
end;
$$;

revoke execute on function public.record_rec_event(text, uuid, text, text, integer[], smallint, integer, integer[], smallint, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_rec_event(text, uuid, text, text, integer[], smallint, integer, integer[], smallint, text, jsonb, uuid)
  to service_role;

create index if not exists rec_events_user on public.rec_events (user_id) where user_id is not null;

-- A deleted account's events stay, re-keyed like its votes. Every account's event carries its user_id, so the index
-- finds them; votes keep their own match.
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'x:' || gen_random_uuid()::text;
begin
  update public.swap_votes
  set voter_key = v_key, user_id = null
  where voter_key = 'u:' || old.id::text or user_id = old.id;
  update public.rec_events
  set voter_key = v_key, user_id = null
  where user_id = old.id;
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

-- === Combos: every complete one, the one-short ones capped ===

create or replace function public.serving_deck_combos(
  p_card_ids integer[],
  p_commander_ids integer[],
  p_exclude integer[] default '{}',
  p_allow_game_changers boolean default true,
  p_near boolean default true,
  p_limit integer default 600
)
returns table (
  variant_id text,
  pieces integer[],
  min_bracket smallint,
  results text[],
  contextual_results text[],
  template_names text[],
  missing integer,
  card public.serving_card
)
language sql
stable
security definer
set search_path = ''
as $$
  with deck as materialized (
    select coalesce(array_agg(distinct x), '{}'::integer[]) as ids
    from unnest(coalesce(p_card_ids, '{}'::integer[]) || coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  commanders as materialized (
    select coalesce(array_agg(distinct x), '{}'::integer[]) as ids from unnest(coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  colours as (
    select coalesce(bit_or(c.color_identity), 0)::smallint as mask
    from public.cards c, commanders m
    where c.id = any (m.ids) and c.deleted_at is null
  ),
  hits as materialized (
    select p.variant_id, p.pieces, p.commander_pieces, p.min_bracket, count(*)::integer as held
    from public.spellbook_combo_pieces p, deck d
    where p.card_id = any (d.ids)
    group by p.variant_id, p.pieces, p.commander_pieces, p.min_bracket
    having count(*) >= cardinality(p.pieces) - case when p_near then 1 else 0 end
  ),
  combos as materialized (
    select h.variant_id, h.pieces, h.min_bracket,
           case when h.held < cardinality(h.pieces)
                then (select m from unnest(h.pieces) as m, deck d where m <> all (d.ids) limit 1)
           end as missing
    from hits h, commanders cm
    where h.commander_pieces <@ cm.ids
  ),
  allowed as (
    select c.variant_id, c.pieces, c.min_bracket, c.missing,
           row_number() over (order by c.missing is not null, cardinality(c.pieces), c.variant_id) as place
    from combos c
    cross join colours
    left join public.cards card on card.id = c.missing
    where c.missing is null
       or (card.deleted_at is null
           and card.legal_commander = 'legal'
           and not card.is_basic_land
           and (card.color_identity & ~colours.mask) = 0
           and card.id <> all (coalesce(p_exclude, '{}'::integer[]))
           and (p_allow_game_changers or not card.game_changer))
  ),
  -- Every complete combo, then the one-short ones up to p_limit: the bracket rules read the complete ones.
  picked as materialized (
    select a.variant_id, a.pieces, a.min_bracket, a.missing
    from allowed a
    where a.missing is null
       or a.place <= (select count(*) from allowed c where c.missing is null) + greatest(coalesce(p_limit, 0), 0)
  )
  select p.variant_id, p.pieces, p.min_bracket, d.results, d.contextual_results, d.template_names, p.missing, r
  from picked p
  join public.spellbook_combo_details d on d.variant_id = p.variant_id
  left join public.serving_cards(p_commander_ids, array(select distinct missing from picked where missing is not null)) r
    on r.card_id = p.missing
  order by p.missing is not null, cardinality(p.pieces), p.variant_id
$$;

revoke all on function public.serving_deck_combos(integer[], integer[], integer[], boolean, boolean, integer) from public;
grant execute on function public.serving_deck_combos(integer[], integer[], integer[], boolean, boolean, integer)
  to anon, authenticated, service_role;

-- === Affinity: what an anonymous caller may ask for is clamped ===

create or replace function public.serving_deck_affinity(
  p_commander_ids integer[],
  p_card_ids integer[],
  p_exclude integer[] default '{}',
  p_allow_game_changers boolean default true,
  p_neighbours integer default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with limits as (
    select (select (value ->> 'deckCards')::integer from public.app_config where key = 'serving_limits') as deck_cards,
           (select (value -> 'affinity' ->> 'neighbours')::integer from public.app_config where key = 'scoring') as neighbours
  ),
  commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids
    from unnest(coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  wanted as (
    select greatest(least(coalesce(p_neighbours, l.neighbours), l.neighbours), 0) as n from limits l
  ),
  target as materialized (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           coalesce((select bit_or(c.color_identity) from public.cards c where c.id = any (m.ids) and c.deleted_at is null), 0)::smallint as mask,
           (select k.id from public.commander_keys k
             where k.commander_1 = m.ids[1] and coalesce(k.commander_2, 0) = coalesce(m.ids[2], 0)) as key_id
    from commanders m
  ),
  deck as materialized (
    select distinct x as card_id
    from unnest((coalesce(p_card_ids, '{}'::integer[]))[1:(select deck_cards from limits)]) as x
  ),
  own as materialized (
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p
    join target t on p.commander_1 = t.c1 and p.commander_2 = t.c2
    join deck d on d.card_id = p.card_a
    union
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p
    join target t on p.commander_1 = t.c1 and p.commander_2 = t.c2
    join deck d on d.card_id = p.card_b
  ),
  glob as materialized (
    select p.card_a, p.card_b, p.lift from public.card_pairs p join deck d on d.card_id = p.card_a
    union
    select p.card_a, p.card_b, p.lift from public.card_pairs p join deck d on d.card_id = p.card_b
  ),
  weights as (
    select d.card_id, coalesce(s.inclusion_shrunk, g.rate, 0)::real as rate, coalesce(s.decks_with, 0) as key_decks
    from deck d
    cross join target t
    left join public.commander_card_stats s on s.commander_key_id = t.key_id and s.card_id = d.card_id
    left join public.card_global_stats g on g.card_id = d.card_id
  ),
  links as (
    -- Each pair from the deck card's side: the other card, and ln(lift) from the key's table (0) or the corpus's (1).
    select case when exists (select 1 from deck d where d.card_id = x.card_a) then x.card_b else x.card_a end as other,
           ln(x.lift) as pmi,
           x.source
    from (select card_a, card_b, lift, 0 as source from own union all select card_a, card_b, lift, 1 from glob) x
  ),
  strongest as (
    -- A card the key's pairs know is read from them; otherwise from the corpus's.
    select l.other,
           case when bool_or(l.source = 0) then sum(l.pmi) filter (where l.source = 0) else sum(l.pmi) end as strength
    from links l
    where not exists (select 1 from deck d where d.card_id = l.other)
    group by l.other
  ),
  neighbours as materialized (
    select s.other as card_id, row_number() over (order by s.strength desc, s.other) as rank
    from strongest s
    join public.cards card on card.id = s.other
    cross join target t
    cross join wanted w
    where w.n > 0
      and card.deleted_at is null
      and card.legal_commander = 'legal'
      and not card.is_basic_land
      and (card.color_identity & ~t.mask) = 0
      and card.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not card.game_changer)
    order by s.strength desc, s.other
    limit (select n from wanted)
  )
  select jsonb_build_object(
    'own', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from own), '[]'::jsonb),
    'global', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from glob), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(card_id, rate, key_decks)) from weights), '[]'::jsonb),
    'neighbours', coalesce(
      (select jsonb_agg(to_jsonb(r) order by n.rank)
         from public.serving_cards(p_commander_ids, array(select card_id from neighbours)) r
         join neighbours n on n.card_id = r.card_id),
      '[]'::jsonb)
  )
$$;

revoke all on function public.serving_deck_affinity(integer[], integer[], integer[], boolean, integer) from public;
grant execute on function public.serving_deck_affinity(integer[], integer[], integer[], boolean, integer)
  to anon, authenticated, service_role;

-- === Builds: clamped, pairs by index, basics by slug ===

create or replace function public.serving_build_pool(
  p_commander_ids integer[],
  p_card_ids integer[],
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_basic_names text[],
  p_owned integer[] default null,
  p_limit integer default 400
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with limits as materialized (
    select (value ->> 'poolCards')::integer as pool_cards, (value ->> 'deckCards')::integer as deck_cards
    from public.app_config where key = 'serving_limits'
  ),
  asked as materialized (
    select least(coalesce(p_limit, l.pool_cards), l.pool_cards) as pool_limit,
           (coalesce(p_card_ids, '{}'::integer[]))[1:l.deck_cards] as card_ids,
           -- A collection is at most app_config.collections.maxEntries cards.
           case when p_owned is null then null
                else p_owned[1:(select (value ->> 'maxEntries')::integer from public.app_config where key = 'collections')]
           end as owned
    from limits l
  ),
  commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids
    from unnest(coalesce(p_commander_ids, '{}'::integer[])) as x
  ),
  target as materialized (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           (select k.id from public.commander_keys k
             where k.commander_1 = m.ids[1] and coalesce(k.commander_2, 0) = coalesce(m.ids[2], 0)) as key_id
    from commanders m
  ),
  pool as materialized (
    select 'own'::text as part, p.pool, p."position", p.card
    from asked a, public.serving_add_pool(p_commander_ids, p_exclude, p_allow_game_changers, a.owned, a.pool_limit, 'adds') p
    union all
    select 'open'::text, p.pool, p."position", p.card
    from asked a, public.serving_add_pool(p_commander_ids, p_exclude, p_allow_game_changers, null, a.pool_limit, 'adds') p
    where a.owned is not null
  ),
  ids as materialized (
    select (p.card).card_id as card_id from pool p where (p.card).card_id is not null
    union
    select x from asked a, unnest(a.card_ids) as x
  ),
  -- The ids as one array, so the pair tables are probed by index instead of hashed whole.
  id_list as materialized (
    select coalesce(array_agg(card_id), '{}'::integer[]) as v from ids
  ),
  own as (
    select p.card_a, p.card_b, p.lift
    from public.commander_card_pairs p, target t, id_list i
    where p.commander_1 = t.c1 and p.commander_2 = t.c2 and p.card_a = any (i.v) and p.card_b = any (i.v)
  ),
  glob as (
    select p.card_a, p.card_b, p.lift
    from public.card_pairs p, id_list i
    where p.card_a = any (i.v) and p.card_b = any (i.v)
  ),
  weights as (
    select i.card_id, coalesce(s.inclusion_shrunk, g.rate, 0)::real as rate, coalesce(s.decks_with, 0) as key_decks
    from ids i
    cross join target t
    left join public.commander_card_stats s on s.commander_key_id = t.key_id and s.card_id = i.card_id
    left join public.card_global_stats g on g.card_id = i.card_id
  ),
  basics as (
    -- By slug (unique, indexed): a basic land's slug is its name in lower case.
    select c.id from public.cards c
    where c.slug = any (array(select lower(n) from unnest(coalesce(p_basic_names, '{}'::text[])) as n))
      and c.is_basic_land and c.deleted_at is null
  ),
  combos as materialized (
    select * from public.serving_deck_combos((select v from id_list), p_commander_ids, p_exclude, p_allow_game_changers, true)
  )
  select jsonb_build_object(
    'pool', coalesce((select jsonb_agg(jsonb_build_object('part', part, 'pool', pool, 'position', "position", 'card', card)) from pool), '[]'::jsonb),
    'own', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from own), '[]'::jsonb),
    'global', coalesce((select jsonb_agg(jsonb_build_array(card_a, card_b, lift)) from glob), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_array(card_id, rate, key_decks)) from weights), '[]'::jsonb),
    -- Each missing card once: many combos share one.
    'combos', coalesce((select jsonb_agg(to_jsonb(c) - 'card') from combos c), '[]'::jsonb),
    'missing', coalesce(
      (select jsonb_agg(m.card) from (select distinct on (c.missing) c.card from combos c where c.missing is not null order by c.missing) m),
      '[]'::jsonb),
    'basics', coalesce(
      (select jsonb_agg(to_jsonb(r)) from public.serving_cards(p_commander_ids, array(select id from basics)) r),
      '[]'::jsonb)
  )
$$;

revoke all on function public.serving_build_pool(integer[], integer[], integer[], boolean, text[], integer[], integer) from public;
grant execute on function public.serving_build_pool(integer[], integer[], integer[], boolean, text[], integer[], integer)
  to anon, authenticated, service_role;

-- === The colours' pool: a collection matched through a hashed set ===

create or replace function public.serving_baseline_pool(
  p_identity_mask smallint,
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[],
  p_limit integer
)
returns table (card_id integer, "position" integer)
language sql
stable
security definer
set search_path = ''
set enable_nestloop = off
as $$
  select x.card_id, row_number() over (order by x.rate desc, x.name)::integer
  from (
    select g.card_id, g.rate, c.name
    from public.card_global_stats g
    join public.cards c on c.id = g.card_id
    where c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      -- `in (select unnest(...))` is a hashed set; `= any (p_owned)` walked the array for every candidate.
      and (p_owned is null or c.id in (select unnest(p_owned)))
    order by g.rate desc, c.name
    limit p_limit
  ) x
$$;

revoke execute on function public.serving_baseline_pool(smallint, integer[], boolean, integer[], integer) from public, anon, authenticated;
