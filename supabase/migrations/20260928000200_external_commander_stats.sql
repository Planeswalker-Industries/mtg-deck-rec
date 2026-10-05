-- Published statistics from other sites (EDHREC first), loaded by `sync:edhrec` from EDHREC's commander pages. A
-- statistics source, never a deck source: EDHREC's numbers come from the same Archidekt and
-- Moxfield decks we crawl, so they are kept apart from our own deck counts and never added to them.
-- docs/roadmap/card-graph-plan.md ("External statistics") says how they are meant to be used: a prior for commanders
-- with too few decks of our own, and a benchmark. Nothing reads them yet.
--
-- Commanders are keyed by their own cards rather than by commander_keys: that table holds the commanders our corpus
-- has decks for (and commander pages are served from it), while EDHREC covers every commander it has seen.
-- Join to commander_keys on (commander_1, coalesce(commander_2, 0)).

create table public.external_commanders (
  id integer generated always as identity primary key,
  source text not null check (source in ('edhrec')),
  -- The source's page slug, e.g. 'liesa-forgotten-archangel'.
  slug text not null,
  commander_1 integer not null references public.cards (id) on delete cascade,
  commander_2 integer references public.cards (id) on delete cascade,
  -- Decks the source's page covers.
  deck_count integer not null check (deck_count >= 0),
  -- When the page was fetched.
  fetched_at timestamptz not null,
  unique (source, slug),
  check (commander_2 is null or commander_1 < commander_2)
);

create unique index external_commanders_pair on public.external_commanders (source, commander_1, (coalesce(commander_2, 0)));

-- One row per card the page lists. The source trims its lists (EDHREC stops near 5% of decks for big commanders),
-- so a missing row means "not published", not "never played".
create table public.external_commander_card_stats (
  external_commander_id integer not null references public.external_commanders (id) on delete cascade,
  card_id integer not null references public.cards (id) on delete cascade,
  decks_with integer not null check (decks_with >= 0),
  -- Decks that could have run the card; below deck_count for a card newer than some of the decks.
  potential_decks integer not null check (potential_decks > 0 and decks_with <= potential_decks),
  -- The source's own synergy figure, as published.
  synergy real,
  primary key (external_commander_id, card_id)
);

create index external_commander_card_stats_card on public.external_commander_card_stats (card_id);

-- Third-party aggregates that are not shown to visitors: no API role reads them.
alter table public.external_commanders enable row level security;
alter table public.external_commander_card_stats enable row level security;
revoke all on public.external_commanders, public.external_commander_card_stats from anon, authenticated;
grant all on public.external_commanders, public.external_commander_card_stats to service_role;
