-- Mana base (T046). What a card can put onto the battlefield from the library (fetch lands, land ramp), read from its
-- rules text by sync:catalog (@mtg/core landSearch), and the mana columns serving_cards hands the app, so Deck stats
-- can count colour sources. Scryfall's produced_mana lists nothing for a fetch land, hence the parsed columns.
--
-- Goes out before the worker that fills it: until the next sync:catalog, fetchable_mana is null everywhere and every
-- fetch land counts as no source.

alter table public.cards
  add column if not exists fetchable_mana text[],
  add column if not exists fetchable_basic_only boolean not null default false;

comment on column public.cards.fetchable_mana is
  'Colours (WUBRGC) of the lands the card can put onto the battlefield from the library; null when none. Parsed from oracle text at sync:catalog (T046).';
comment on column public.cards.fetchable_basic_only is
  'The card finds basic lands only (Evolving Wilds, Fabled Passage) (T046).';

-- === search index: documents now carry the mana columns (and mana_cost, which the list had missed) ===

drop trigger if exists search_index_cards_update on public.cards;
create trigger search_index_cards_update
after update on public.cards
for each row
when (
  (old.name, old.name_normalized, old.slug, old.type_line, old.mana_value, old.color_identity, old.keywords,
   old.game_changer, old.is_basic_land, old.legal_commander, old.can_be_commander, old.partner_kind,
   old.partner_qualifier, old.copy_limit, old.artist, old.images, old.released_at, old.reference_price_usd,
   old.reference_price_finish, old.prices_as_of, old.deleted_at, old.mana_cost, old.produced_mana,
   old.fetchable_mana, old.fetchable_basic_only, old.layout)
  is distinct from
  (new.name, new.name_normalized, new.slug, new.type_line, new.mana_value, new.color_identity, new.keywords,
   new.game_changer, new.is_basic_land, new.legal_commander, new.can_be_commander, new.partner_kind,
   new.partner_qualifier, new.copy_limit, new.artist, new.images, new.released_at, new.reference_price_usd,
   new.reference_price_finish, new.prices_as_of, new.deleted_at, new.mana_cost, new.produced_mana,
   new.fetchable_mana, new.fetchable_basic_only, new.layout)
)
execute function public.enqueue_search_card_by_id();

-- Documents already in the index have no mana columns, and the trigger above only queues the cards whose columns
-- change (fetch lands, at the next sync:catalog). '*' has the next sync:typesense reindex every card, as for a tag
-- hierarchy change, so a Plains read from the index makes {W} before anyone runs --rebuild.
insert into public.search_index_queue (collection, document_id)
values ('cards', '*')
on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();

-- === serving_card: the mana columns, and layout (a spell/land MDFC or a card that transforms into a land) ===

alter type public.serving_card
  add attribute produced_mana text[],
  add attribute fetchable_mana text[],
  add attribute fetchable_basic_only boolean,
  add attribute layout text;

-- serving_cards: as 20261008000100_derived_pairs.sql, with the four columns last (the type's attribute order).
create or replace function public.serving_cards(p_commander_ids integer[], p_card_ids integer[])
returns setof public.serving_card
language sql
stable
security definer
set search_path = ''
set enable_nestloop = on
as $$
  with commanders as (
    select coalesce(array_agg(distinct x order by x), '{}'::integer[]) as ids from unnest(p_commander_ids) as x
  ),
  target_set as (
    select m.ids[1] as c1,
           coalesce(m.ids[2], 0) as c2,
           cardinality(m.ids) as n,
           s.commander_1 is not null as known,
           coalesce(s.derived, false) as derived,
           s.edhrec_floor,
           s.edhrec_decks,
           k.id as key_id,
           st.deck_count as key_decks
    from commanders m
    left join public.commander_sets s on s.commander_1 = m.ids[1] and s.commander_2 = coalesce(m.ids[2], 0)
    left join public.commander_keys k on s.derived and k.commander_1 = m.ids[1] and k.commander_2 = m.ids[2]
    left join public.commander_stats st on st.commander_key_id = k.id
  )
  select c.id,
         c.oracle_id, c.name, c.slug, c.mana_value, c.mana_cost, c.type_line, c.color_identity, c.images, c.game_changer,
         c.released_at, c.reference_price_usd, c.reference_price_finish, c.prices_as_of, c.legal_commander,
         c.can_be_commander, c.partner_kind, c.partner_qualifier, c.copy_limit, c.is_basic_land, c.artist, c.keywords,
         to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM'),
         g.rate, g.decks_with, g.eligible_decks,
         s.decks_with, s.commander_decks,
         p.decks_with, p.too_early,
         coalesce(r.role_ids, '{}'::uuid[]),
         coalesce(s.prior_rate, pr.prior_rate), coalesce(s.prior_decks, pr.prior_decks), t.edhrec_floor, t.edhrec_decks,
         case when t.derived then coalesce(o.decks_with, 0) end,
         case when t.derived then coalesce(t.key_decks - coalesce(o.eligible_decks, t.key_decks), 0) end,
         c.produced_mana, c.fetchable_mana, c.fetchable_basic_only, c.layout
  from (select distinct unnest(p_card_ids) as id) ids
  join public.cards c on c.id = ids.id and c.deleted_at is null
  cross join target_set t
  left join public.card_stats st on st.card_id = c.id
  left join public.card_global_stats g on g.card_id = c.id
  left join public.commander_card_scores s
    on t.known and s.commander_1 = t.c1 and s.commander_2 = t.c2 and s.card_id = c.id
  left join public.commander_card_stats o
    on t.derived and o.commander_key_id = t.key_id and o.card_id = c.id
  left join public.commander_card_priors pr
    on t.derived and pr.commander_1 = t.c1 and pr.commander_2 = t.c2 and pr.card_id = c.id
  left join lateral (
    select sum(pt.decks_with)::integer as decks_with, sum(pt.too_early)::integer as too_early
    from public.partner_card_totals pt
    where (not t.known or t.derived) and t.n = 2 and pt.commander_id in (t.c1, t.c2) and pt.card_id = c.id
  ) p on true
  left join lateral (
    select array_agg(cr.role_id order by cr.role_id) as role_ids from public.card_roles cr where cr.card_id = c.id
  ) r on true
$$;

revoke execute on function public.serving_cards(integer[], integer[]) from public;
grant execute on function public.serving_cards(integer[], integer[]) to anon, authenticated, service_role;
