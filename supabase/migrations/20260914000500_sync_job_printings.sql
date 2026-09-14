-- Own migration: a new enum value can't be used in the transaction that adds it.
alter type public.sync_job add value if not exists 'scryfall_printings';
