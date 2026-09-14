-- The planner can't estimate this function's CTEs (they depend on its arguments) and guesses about one row each, so it
-- chose nested loops over thousands of candidate rows. Fumigate in a white-black deck took 3.2 s (4.3 s once exclusive
-- tag modes were added), over the 3 s anonymous-role timeout, and Swords to Plowshares for a five-color deck 8.5 s.
-- With nested loops off while the function runs, the same calls take 0.1-0.3 s and return the same candidates.
-- A later CREATE OR REPLACE of this function resets its settings: repeat this SET there.
alter function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer)
  set enable_nestloop = off;
