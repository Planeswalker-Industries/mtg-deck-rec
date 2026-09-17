-- Both recommendation functions pick their candidate pool straight out of public.cards: rec_add_candidates joins it in
-- its `pool` CTE, rec_swap_candidates scans it in `eligible`. Neither reads a wide column, but cards is 121 MB of heap
-- (oracle text, images, prices), and with enable_nestloop off both plan a hash join, so every call swept the whole heap:
-- 18k buffers (~142 MB) for one add, 21k (~165 MB) for one swap.
--
-- The hosted free tier has 224 MB of shared_buffers, so a single call touched more than half the cache and a swap
-- touched more than all of it. Warm, the calls run in 90-160 ms; once those pages are evicted (by the next call, a
-- sync, or an idle period) they come back from disk and the call takes seconds, which is what tripped the anon 3 s
-- statement timeout on commander pages and swaps.
--
-- This index covers every cards column those two functions read, under the same filters they apply, so the pool comes
-- from a 1.8 MB index-only scan instead of the heap. Measured locally: add 18,146 -> 2,784 buffers (71 ms -> 35 ms),
-- swap 21,188 -> 5,860 buffers (100 ms -> 74 ms).
--
-- The included columns are never touched by the daily price update, so cards keeps its HOT updates (see the storage
-- budget notes: rewriting rows is what costs space here).
create index if not exists cards_rec_pool on public.cards (id)
  include (color_identity, game_changer, name, mana_value, equivalence_base_id)
  where deleted_at is null and legal_commander = 'legal' and not is_basic_land;
