-- sync_runs jobs for card pairs (T064). Their own migration: a new enum value can't be used in the transaction that
-- adds it.
-- precompute_pairs:        commander_card_pairs for the commander keys whose stats moved since the last run (--full: every key).
-- precompute_global_pairs: card_pairs over the whole corpus, weekly.
alter type public.sync_job add value if not exists 'precompute_pairs';
alter type public.sync_job add value if not exists 'precompute_global_pairs';
