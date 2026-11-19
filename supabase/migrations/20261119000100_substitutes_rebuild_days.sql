-- Unchanged substitute lists are rebuilt every 60 days instead of every 7 (owner, 2026-11-19). A rebuild of 4,096 lists
-- on 2026-11-19 changed 0.57% of their rows beyond the similarity tolerance: hours of database time for almost nothing.
-- After a set release, clear every hash by hand (`update public.substitute_targets set tags_hash = ''`) and the worker
-- rebuilds every list in its passes. Only that one key changes.
update public.app_config
   set value = jsonb_set(value, '{substitutesRebuildDays}', '60'::jsonb),
       updated_at = now()
 where key = 'worker'
   and value -> 'substitutesRebuildDays' is distinct from '60'::jsonb;
