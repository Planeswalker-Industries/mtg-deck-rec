-- The collator (T054): `cli collate` resolves every raw source into corpus with one set of rules, so the aggregates and
-- the precompute worker read one place. docs/roadmap/card-graph-plan.md, "Collator (T054)".
--
-- * corpus.spellbook_combos: Commander Spellbook's combos resolved to our cards, the collated half of PR #127.
-- * corpus.collate_state: how far each source's last collation got, written in the same transaction as its rows, so a
--   collation that fails leaves the next one to start from the same place.
-- * corpus.decks marks its commanders dirty on every write, whoever writes: the collator, or a player deleting a deck
--   (the foreign key cascades).
-- * app_config: minDecks and fullDecks are both 50 (owner decision 2026-10-05), the collator's sanity gate, and
--   EDHREC's fetch settings for `sync:edhrec`.

-- === Spellbook, collated ===

create table corpus.spellbook_combos (
  -- Spellbook's variant id; commanderspellbook.com/combo/<id>/ is its page, which every displayed combo links to.
  variant_id text primary key,
  -- The named pieces as our card ids, ascending.
  card_ids integer[] not null check (cardinality(card_ids) > 0),
  -- Pieces the combo needs as the commander.
  commander_card_ids integer[] not null default '{}',
  -- Pieces described rather than named ("Legendary Elemental Creature"): any card matching one fills it.
  template_names text[] not null default '{}',
  -- What it produces: standalone results ("Win the game") and results that matter in context. Spellbook's hidden
  -- chaining steps are dropped.
  results text[] not null default '{}',
  contextual_results text[] not null default '{}',
  -- The lowest bracket that allows it, from Spellbook's bracket tag (E 1, O and C 2, S and P 3, R 4). Combos tagged
  -- banned in Commander are left out.
  min_bracket smallint not null check (min_bracket between 1 and 5),
  -- Union of the pieces' colour identities (bitmask W=1 U=2 B=4 R=8 G=16).
  color_identity smallint not null check (color_identity between 0 and 31),
  -- Mana needed to run the loop once the pieces are in place, beyond casting them.
  mana_value_needed smallint not null check (mana_value_needed >= 0),
  constraint spellbook_combos_commander_pieces check (commander_card_ids <@ card_ids)
);

comment on table corpus.spellbook_combos is
  'Commander Spellbook''s combos whose every piece resolved to our catalog, written only by the collator from spellbook.*. Spellbook''s EDHREC deck count stays in raw.';

-- === where each source's collation got to ===

create table corpus.collate_state (
  source text primary key check (source in ('archidekt', 'moxfield', 'user', 'edhrec', 'spellbook')),
  -- Deck sources: the next collation reads raw rows written since this, less an overlap for writes in flight.
  raw_since timestamptz,
  -- EDHREC and Spellbook: the sync_runs id of the fetch whose rows the last collation read.
  fetch_run_id bigint,
  -- The catalog_epoch() the last collation resolved against. A newer catalog retries what failed to resolve.
  catalog_epoch bigint not null,
  collated_at timestamptz not null default now()
);

comment on table corpus.collate_state is
  'How far the last successful collation of each source got. Written by the collator in the same transaction as that source''s corpus rows.';

alter table corpus.spellbook_combos enable row level security;
alter table corpus.collate_state enable row level security;
revoke all on corpus.spellbook_combos, corpus.collate_state from anon, authenticated;
grant select, insert, update, delete on corpus.spellbook_combos, corpus.collate_state to service_role;

-- === dirty commanders ===

-- Every write to corpus.decks queues its commanders for the precompute worker (T055): new and old commanders on an
-- update, since a deck can change commander. Statement-level with transition tables, so a collation writing thousands
-- of decks queues each commander once. Security definer: a player deleting their own deck cascades here as that player,
-- who has no access to corpus.
create function corpus.mark_commanders_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into corpus.dirty_commanders (commander_1, commander_2)
    select distinct n.commander_card_ids[1], coalesce(n.commander_card_ids[2], 0) from new_rows n
    on conflict (commander_1, commander_2) do update set seq = nextval('corpus.dirty_commanders_seq');
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    insert into corpus.dirty_commanders (commander_1, commander_2)
    select distinct o.commander_card_ids[1], coalesce(o.commander_card_ids[2], 0) from old_rows o
    on conflict (commander_1, commander_2) do update set seq = nextval('corpus.dirty_commanders_seq');
  end if;
  return null;
end;
$$;

revoke all on function corpus.mark_commanders_dirty() from public;

create trigger decks_dirty_on_insert after insert on corpus.decks
  referencing new table as new_rows for each statement execute function corpus.mark_commanders_dirty();
create trigger decks_dirty_on_update after update on corpus.decks
  referencing old table as old_rows new table as new_rows for each statement execute function corpus.mark_commanders_dirty();
create trigger decks_dirty_on_delete after delete on corpus.decks
  referencing old table as old_rows for each statement execute function corpus.mark_commanders_dirty();

-- === settings ===

-- minDecks and fullDecks are both 50 (owner decision 2026-10-05). collateMaxRemovedShare: a collation that would take
-- more than this share of one source's corpus rows away refuses, so a raw table emptied by mistake can't empty the corpus.
update public.app_config
   set value = value || '{"fullDecks": 50, "collateMaxRemovedShare": 0.1}'::jsonb, updated_at = now()
 where key = 'corpus'
   and (value -> 'fullDecks' is distinct from '50'::jsonb or value -> 'collateMaxRemovedShare' is distinct from '0.1'::jsonb);

-- `sync:edhrec`: EDHREC's pages are static files behind CloudFront, but one request every one and a half seconds is
-- polite. A block sets `disabledReason`, and only a person clears it.
insert into public.app_config (key, value) values ('edhrec', '{"requestIntervalMs": 1500}'::jsonb)
on conflict (key) do nothing;

comment on column public.decks.include_in_corpus is
  'Every card legal and a commander present, set by save_deck. The collator (T054) does not read it: it applies the corpus rule (a legal commander or pair, every card inside the colours, exactly 100 cards) to every saved deck itself, public or private.';
