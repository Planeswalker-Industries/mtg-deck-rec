-- sync_runs jobs for T054. Their own migration: a new enum value can't be used in the transaction that adds it.
-- corpus_collate: `cli collate`, which resolves the raw sources into corpus.
-- edhrec_pages: `sync:edhrec`, which fetches EDHREC's pages into the raw edhrec tables. A job of its own rather than
-- the retired `import:edhrec`'s edhrec_stats, so the collator never takes one of those old runs for a fetch of raw.
alter type public.sync_job add value if not exists 'corpus_collate';
alter type public.sync_job add value if not exists 'edhrec_pages';
