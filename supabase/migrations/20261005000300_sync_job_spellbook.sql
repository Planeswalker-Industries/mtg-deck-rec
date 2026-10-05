-- The sync_runs job for `sync:spellbook`, which loads Commander Spellbook's combos into the spellbook schema. Its own
-- migration: a new enum value can't be used in the transaction that adds it.
alter type public.sync_job add value if not exists 'spellbook_combos';
