-- Corpus confidence thresholds from the Phase 0 stability measurement (spike:corpus:stability, 2026-09-14, 14,884
-- Archidekt decks, 48 commanders). Two disjoint samples of n decks agree on a commander's top-50 synergy ranking with
-- median Spearman ρ 0.70 at n = 50 and 0.83 at n = 100 (10th percentile 0.54 and 0.70). Split-half agreement is
-- conservative, so 50 decks start the corpus signal and 100 give it full weight (the plan's prior was 300).
update public.app_config
set value = value || '{"minDecks": 50, "fullDecks": 100}'::jsonb, updated_at = now()
where key = 'corpus';
