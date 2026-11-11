-- Builds meet Deck stats (contract v34).
--
-- 1. Every score weight set gains the 'mana' component (how much a land fixes the deck's short colours) at weight 0:
--    it stays 0 until cli eval:holdout passes it.
-- 2. app_config.scoring.build.colourSourceCaps: the most sources a colour row asks for, by colour count (index 0-5).
--    Karsten's per-card numbers suit one and two colours; decks in three or more can't reach them. The caps are the 75th
--    percentile of land sources per colour in the collated corpus on 2026-11-09 (lands making or fetching the colour,
--    plus basics split evenly): 3 colours 20.3, 4 colours 18.5, 5 colours 18.4.
--
-- Only the keys that are missing are written, so a value the owner has tuned is never overwritten.

update public.app_config
   set value = jsonb_set(value, '{weights,add,mana}', '0'::jsonb),
       updated_at = now()
 where key = 'scoring'
   and not (value -> 'weights' -> 'add') ? 'mana';

update public.app_config
   set value = jsonb_set(value, '{weights,swap,collection_less,mana}', '0'::jsonb),
       updated_at = now()
 where key = 'scoring'
   and not (value -> 'weights' -> 'swap' -> 'collection_less') ? 'mana';

update public.app_config
   set value = jsonb_set(value, '{weights,swap,collection_aware,mana}', '0'::jsonb),
       updated_at = now()
 where key = 'scoring'
   and not (value -> 'weights' -> 'swap' -> 'collection_aware') ? 'mana';

update public.app_config
   set value = jsonb_set(value, '{build,colourSourceCaps}', '[null, null, null, 20, 18, 18]'::jsonb),
       updated_at = now()
 where key = 'scoring'
   and not (value -> 'build') ? 'colourSourceCaps';
