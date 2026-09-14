-- Keeps the database small enough for a free hosted tier (500 MB); compacted, it's about 280 MB.
--
-- card_tag_vectors was planned as a GIN prefilter for swap candidates, but rec_swap_candidates never used it. It cost
-- 19 MB plus a full refresh on every tag sync.
drop materialized view if exists public.card_tag_vectors;

-- sync:printings refreshes every card's reference price once a day. Leaving a fifth of each page free lets those
-- updates stay on the same page (price columns aren't indexed), so the table and its indexes don't grow with each run.
-- Applies to pages written from now on; a fresh load or VACUUM FULL applies it everywhere.
alter table public.cards set (fillfactor = 80);
