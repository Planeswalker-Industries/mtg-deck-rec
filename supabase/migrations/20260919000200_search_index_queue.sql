-- Keeping the search index in step with the database.
--
-- The index (Typesense, self-hosted) holds the documents the app reads most: cards by id, tags, commanders and
-- per-commander play rates. Nothing in here talks to it. Instead, every table a document is built from writes the
-- **stable key** of the affected document into a queue, and the worker drains that queue after each sync
-- (`cli sync:typesense`). Reasons for that shape rather than a direct call from Postgres:
--
--   * A trigger that made an HTTP request would tie a sync transaction's fate to a network hop, and these tables are
--     written inside one transaction that must not get slower or less reliable.
--   * The queue is the retry. A failed or killed drain replays, because a row is deleted only after the import for it
--     succeeded.
--   * It keeps the index's credentials out of the database entirely.
--
-- The queue is keyed on (collection, document_id) and upserted, so it is bounded by the number of distinct changed
-- documents rather than growing with traffic — the same shape as public.rec_timeouts.

-- The functional tag set *without* the kill switch applied.
--
-- public.functional_tags filters out disabled tags, which is right for the SQL recommendation functions: they read it
-- at query time, so turning a tag off takes effect at once. A document is written once and read many times, so
-- applying the switch at index time would mean reindexing 34,800 cards to disable one tag. Instead the card documents
-- carry every tag the hierarchy reaches and the app drops the disabled ones as it reads, using the (tiny) tags
-- collection. This view is what the indexer walks; public.functional_tags is unchanged and still what SQL uses.
create or replace view public.functional_tags_all as
with allowed_roots as (
  select r.id::uuid as id
  from public.app_config cfg
  cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as r (id)
  where cfg.key = 'functional_tag_roots'
),
denied as (
  select distinct tc.descendant_id as tag_id
  from public.app_config cfg
  cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as r (id)
  join public.tag_closure tc on tc.ancestor_id = r.id::uuid
  where cfg.key = 'functional_tag_denied_roots'
)
select distinct tc.descendant_id as tag_id
from allowed_roots a
join public.tag_closure tc on tc.ancestor_id = a.id
join public.tags t on t.id = tc.descendant_id and t.deleted_at is null
where tc.descendant_id not in (select tag_id from denied)
   or tc.descendant_id in (select id from allowed_roots);

-- Only the worker reads this view; the API roles have no reason to and it is not cheap.
revoke all on public.functional_tags_all from public;
grant select on public.functional_tags_all to service_role;

-- document_id is the document's **stable key**, not its id in the index where those differ: a card is its integer id,
-- a commander its key id, a (commander, card) rate its "key:card" pair, a tag its UUID. Slugs are derived from names
-- and change on a rename, so they can't be what a queue row points at.
--
-- There is deliberately no "upsert or delete" column. The drain looks the row up: still there means write the
-- document, gone or soft-deleted means remove it. That way a hard delete, a soft delete and an un-delete all take the
-- same path, and a queue row can never disagree with the table it came from.
--
-- `seq` is what the drain deletes by, and it is a counter rather than a timestamp for a reason that cost an
-- afternoon: the worker's driver parses a timestamp parameter into a JS Date, which has millisecond precision, so a
-- microsecond-precision `enqueued_at` read out and passed back compared as *older* than the row it came from and
-- deleted nothing. A bigint crosses that boundary exactly. `enqueued_at` stays for reading the table by hand.
create sequence public.search_index_queue_seq;

create table public.search_index_queue (
  collection text not null check (collection in ('cards', 'tags', 'commanders', 'commander_cards')),
  document_id text not null,
  seq bigint not null default nextval('public.search_index_queue_seq'),
  enqueued_at timestamptz not null default now(),
  primary key (collection, document_id)
);

-- The drain reads oldest first and deletes what it has written, so this is the index that matters.
create index search_index_queue_seq_idx on public.search_index_queue (seq);

comment on table public.search_index_queue is
  'Documents the search index needs to be told about. Drained by the worker (cli sync:typesense); see docs/roadmap/typesense-plan.md.';

-- Nothing outside the worker has any business reading or writing this: RLS on with no policies, and no grants to the
-- API roles. Same stance as public.rec_timeouts.
alter table public.search_index_queue enable row level security;
grant all on public.search_index_queue to service_role;
grant usage on sequence public.search_index_queue_seq to service_role;

-- One small function per key shape rather than one generic one. A generic trigger has to reach the key column
-- through dynamic SQL or to_jsonb(new), and the daily price update fires this on tens of thousands of wide card rows
-- in a single statement — serialising each of them to build a queue row it already knows the key of is exactly the
-- cost not worth paying.

create function public.enqueue_search_card_by_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values ('cards', (case when tg_op = 'DELETE' then old.id else new.id end)::text)
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

create function public.enqueue_search_card_by_card_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values ('cards', (case when tg_op = 'DELETE' then old.card_id else new.card_id end)::text)
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

create function public.enqueue_search_tag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values ('tags', (case when tg_op = 'DELETE' then old.id else new.id end)::text)
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

create function public.enqueue_search_commander_by_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values ('commanders', (case when tg_op = 'DELETE' then old.id else new.id end)::text)
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

-- A commander's deck count is on its own document *and* on the card document of a solo commander, where it is the
-- sort key that puts real commanders first in a picker. So a stats change enqueues both.
create function public.enqueue_search_commander_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key integer := case when tg_op = 'DELETE' then old.commander_key_id else new.commander_key_id end;
begin
  insert into public.search_index_queue (collection, document_id)
  values ('commanders', v_key::text)
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();

  insert into public.search_index_queue (collection, document_id)
  select 'cards', k.commander_1::text
  from public.commander_keys k
  where k.id = v_key and k.commander_2 is null
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

create function public.enqueue_search_commander_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values (
    'commander_cards',
    case when tg_op = 'DELETE'
      then old.commander_key_id || ':' || old.card_id
      else new.commander_key_id || ':' || new.card_id
    end
  )
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

-- A whole collection that has to be rebuilt because something all of its documents depend on moved: the tag
-- hierarchy, or the allow and deny lists that decide which tags count as functional. '*' is not an id any table can
-- produce, and the drain reads it as "reindex this collection".
create function public.enqueue_search_reindex()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.search_index_queue (collection, document_id)
  values (tg_argv[0], '*')
  on conflict (collection, document_id) do update set seq = nextval('public.search_index_queue_seq'), enqueued_at = now();
  return null;
end $$;

-- Cards. The update trigger's when clause lists exactly the columns a card document is built from, so an update that
-- only moves rules_hash or equivalence_base_id (which no document carries) costs nothing. deleted_at is in the list
-- because a soft delete has to remove the document.
create trigger search_index_cards
after insert or delete on public.cards
for each row execute function public.enqueue_search_card_by_id();

create trigger search_index_cards_update
after update on public.cards
for each row
when (
  (old.name, old.name_normalized, old.slug, old.type_line, old.mana_value, old.color_identity, old.keywords,
   old.game_changer, old.is_basic_land, old.legal_commander, old.can_be_commander, old.partner_kind,
   old.partner_qualifier, old.copy_limit, old.artist, old.images, old.released_at, old.reference_price_usd,
   old.reference_price_finish, old.prices_as_of, old.deleted_at)
  is distinct from
  (new.name, new.name_normalized, new.slug, new.type_line, new.mana_value, new.color_identity, new.keywords,
   new.game_changer, new.is_basic_land, new.legal_commander, new.can_be_commander, new.partner_kind,
   new.partner_qualifier, new.copy_limit, new.artist, new.images, new.released_at, new.reference_price_usd,
   new.reference_price_finish, new.prices_as_of, new.deleted_at)
)
execute function public.enqueue_search_card_by_id();

-- Everything else a card document is built from points back at a card.
create trigger search_index_card_names
after insert or update or delete on public.card_names
for each row execute function public.enqueue_search_card_by_card_id();

create trigger search_index_card_tags
after insert or update or delete on public.card_tags
for each row execute function public.enqueue_search_card_by_card_id();

create trigger search_index_card_stats
after insert or delete on public.card_stats
for each row execute function public.enqueue_search_card_by_card_id();

create trigger search_index_card_stats_update
after update on public.card_stats
for each row
when ((old.staple_score, old.first_printed_at) is distinct from (new.staple_score, new.first_printed_at))
execute function public.enqueue_search_card_by_card_id();

create trigger search_index_card_global_stats
after insert or delete on public.card_global_stats
for each row execute function public.enqueue_search_card_by_card_id();

create trigger search_index_card_global_stats_update
after update on public.card_global_stats
for each row
when ((old.decks_with, old.eligible_decks, old.rate) is distinct from (new.decks_with, new.eligible_decks, new.rate))
execute function public.enqueue_search_card_by_card_id();

-- Tags: their own small collection, and where the kill switch is read from.
create trigger search_index_tags
after insert or delete on public.tags
for each row execute function public.enqueue_search_tag();

create trigger search_index_tags_update
after update on public.tags
for each row
when ((old.slug, old.label, old.idf, old.disabled, old.deleted_at) is distinct from (new.slug, new.label, new.idf, new.disabled, new.deleted_at))
execute function public.enqueue_search_tag();

create trigger search_index_commander_keys
after insert or update or delete on public.commander_keys
for each row execute function public.enqueue_search_commander_by_id();

create trigger search_index_commander_stats
after insert or update or delete on public.commander_stats
for each row execute function public.enqueue_search_commander_stats();

create trigger search_index_commander_card_stats
after insert or update or delete on public.commander_card_stats
for each row execute function public.enqueue_search_commander_card();

-- Hierarchy changes move which tags a card reaches, for thousands of cards at once, and there is no cheap way to say
-- which. Statement-level, so a tag sync enqueues one sentinel rather than a row per edge.
create trigger search_index_tag_closure
after insert or update or delete on public.tag_closure
for each statement execute function public.enqueue_search_reindex('cards');

-- The allowlist and the denylist decide which tags are functional at all, so editing either re-describes every card.
-- Insert and update only: app_config rows are upserted, never deleted, and a when clause may not read old on insert.
create trigger search_index_functional_roots
after insert or update on public.app_config
for each row
when (new.key in ('functional_tag_roots', 'functional_tag_denied_roots'))
execute function public.enqueue_search_reindex('cards');
