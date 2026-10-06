-- sync_runs jobs for the precompute worker (T055). Their own migration: a new enum value can't be used in the
-- transaction that adds it.
-- precompute_commanders: the stats of commanders whose decks changed (corpus.dirty_commanders), then their scores.
-- precompute_baseline:   the nightly baseline (card_global_stats, corpus_identity_stats) summed from the per-commander
--                        stats, then every score whose baseline moved.
-- precompute_scores:     commander_card_scores and partner_card_totals for every commander, as a run of its own (after a
--                        full aggregate:corpus, or when app_config.corpus changes).
-- precompute_substitutes, precompute_roles, precompute_combos: card_substitutes, card_roles, spellbook_combo_pieces.
alter type public.sync_job add value if not exists 'precompute_commanders';
alter type public.sync_job add value if not exists 'precompute_baseline';
alter type public.sync_job add value if not exists 'precompute_scores';
alter type public.sync_job add value if not exists 'precompute_substitutes';
alter type public.sync_job add value if not exists 'precompute_roles';
alter type public.sync_job add value if not exists 'precompute_combos';
