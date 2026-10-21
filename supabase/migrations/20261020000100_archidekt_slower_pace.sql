-- Archidekt pushed back: five of the six daily crawls from 2026-10-15 to 2026-10-20 failed on an HTTP 429 that the
-- fetcher's backoff (doubling up to requestIntervalMaxMs, then retries up to backoffMaxMs) did not outlast, after
-- weeks of clean runs at one request a second. The fetcher returns to the base pace after paceRecoverRequests clean
-- responses, so a base it keeps getting throttled at is the wrong base. requestIntervalMs 2000 halves the base rate;
-- the rest of the pace (jitter, the 8 s ceiling, the recovery count) stays as it is. Only this key changes.
update public.app_config
   set value = value || '{"requestIntervalMs": 2000}'::jsonb,
       updated_at = now()
 where key = 'archidekt';
