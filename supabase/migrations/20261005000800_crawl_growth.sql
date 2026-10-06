-- T056: a crawl revisit grows a commander's sample (owner rule 2026-10-05). A revisit reads page 1 whole, then reads on
-- until it has fetched `revisitNewDecks` decks that were new or changed, or the list ends. That replaces
-- `revisitPages` (page 1 only, 2026-10-03), under which no commander passed 93 decks. The search API reads both keys
-- leniently, so this and its deploy can land in either order: older code ignores the new key and falls back to one
-- page; newer code ignores the old key and falls back to 25.
--
-- Only rows that still carry the old key, or lack the new one, are written; a share someone has already tuned stays.
update public.app_config
   set value = (value - 'revisitPages')
               || case when value ? 'revisitNewDecks' then '{}'::jsonb else '{"revisitNewDecks": 25}'::jsonb end,
       updated_at = now()
 where key in ('archidekt', 'moxfield')
   and (value ? 'revisitPages' or not value ? 'revisitNewDecks');
