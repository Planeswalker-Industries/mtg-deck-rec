-- How many cards a commander's decks run in each tracked role (deck_role_targets: ramp, card advantage, removal,
-- protection), so cuts and adds judge a deck against what that commander's decks actually run instead of generic
-- targets. Set by aggregate:corpus.
alter table public.commander_stats
  add column role_profile jsonb not null default '{}'::jsonb; -- {"<role tag uuid>": 12.4}: average cards per deck
