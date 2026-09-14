-- Deck corpus aggregates: how often each card appears in decks for a commander (or partner pair), and across every
-- deck whose color identity allows it. Only these counts are stored; third-party decklists never reach the database.
-- The worker (aggregate:corpus) rebuilds the stats tables in one transaction.

create type public.deck_source as enum ('archidekt', 'moxfield', 'user', 'precon');

-- A commander or partner pair. Ids stay stable across rebuilds so later data (votes, commander pages) can point at them.
create table public.commander_keys (
  id integer generated always as identity primary key,
  commander_1 integer not null references public.cards (id),
  commander_2 integer references public.cards (id),
  color_identity smallint not null check (color_identity between 0 and 31),
  slug text not null unique, -- card slugs joined with '--', lower card id first
  created_at timestamptz not null default now(),
  check (commander_2 is null or commander_1 < commander_2)
);

create unique index commander_keys_pair on public.commander_keys (commander_1, (coalesce(commander_2, 0)));
create index commander_keys_commander_2 on public.commander_keys (commander_2) where commander_2 is not null;

create table public.commander_stats (
  commander_key_id integer primary key references public.commander_keys (id) on delete cascade,
  deck_count integer not null,
  source_counts jsonb not null, -- {"archidekt": 812}
  bracket_counts jsonb not null, -- {"unset": 118, "3": 64, ...}
  computed_at timestamptz not null default now()
);

-- p0: of the corpus decks whose color identity allows the card, the share that run it.
create table public.card_global_stats (
  card_id integer primary key references public.cards (id) on delete cascade,
  decks_with integer not null,
  eligible_decks integer not null,
  rate real not null check (rate between 0 and 1),
  computed_at timestamptz not null default now()
);

-- Per commander key: inclusion shrunk toward p0, (x + α·p0) / (n + α), and synergy = shrunk inclusion − p0.
-- Only cards that appear in at least one of the commander's decks have a row.
create table public.commander_card_stats (
  commander_key_id integer not null references public.commander_keys (id) on delete cascade,
  card_id integer not null references public.cards (id) on delete cascade,
  decks_with integer not null,
  inclusion_shrunk real not null,
  synergy real not null,
  primary key (commander_key_id, card_id)
);

create index commander_card_stats_synergy on public.commander_card_stats (commander_key_id, synergy desc);
create index commander_card_stats_inclusion on public.commander_card_stats (commander_key_id, inclusion_shrunk desc);
create index commander_card_stats_card on public.commander_card_stats (card_id);

-- Aggregates are public reference data; writes come only from the worker's service connection.
alter table public.commander_keys enable row level security;
alter table public.commander_stats enable row level security;
alter table public.card_global_stats enable row level security;
alter table public.commander_card_stats enable row level security;

create policy public_read on public.commander_keys for select to anon, authenticated using (true);
create policy public_read on public.commander_stats for select to anon, authenticated using (true);
create policy public_read on public.card_global_stats for select to anon, authenticated using (true);
create policy public_read on public.commander_card_stats for select to anon, authenticated using (true);

grant select on public.commander_keys, public.commander_stats, public.card_global_stats, public.commander_card_stats
  to anon, authenticated;
grant all on public.commander_keys, public.commander_stats, public.card_global_stats, public.commander_card_stats
  to service_role;
grant usage, select on sequence public.commander_keys_id_seq to service_role;

-- Shrinkage strength and corpus confidence thresholds (minDecks: below it, no corpus signal; fullDecks: full weight).
-- Starting values from the plan, to be replaced by the bootstrap stability measurement.
insert into public.app_config (key, value, is_public)
values ('corpus', '{"shrinkAlpha": 20, "minDecks": 50, "fullDecks": 300, "maxUnresolvedCards": 3}'::jsonb, true)
on conflict (key) do update set value = excluded.value, updated_at = now();
