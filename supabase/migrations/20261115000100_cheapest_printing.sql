-- T090: which printing is the cheapest, so the card page can link that printing's TCGplayer product page.
-- `sync:printings` fills it next to cheapest_usd and cheapest_finish (and diffs it, so a rerun writes nothing). Hosted
-- gets it through the release to main; until the next price sync there it stays null and the card page falls back to a
-- TCGplayer search.

alter table public.card_stats
  add column cheapest_printing_id uuid references public.printings (id) on delete set null;

comment on column public.card_stats.cheapest_printing_id is
  'The printing behind cheapest_usd (finish in cheapest_finish); null when no printing has a price.';

-- Nullable foreign keys get a partial index (house style): a catalog sync that deletes printings would otherwise scan
-- card_stats for each one to set this null.
create index card_stats_cheapest_printing on public.card_stats (cheapest_printing_id) where cheapest_printing_id is not null;

-- The table's grants already cover a new column; restated so this migration stands on its own.
grant select on public.card_stats to anon, authenticated;
grant all on public.card_stats to service_role;
