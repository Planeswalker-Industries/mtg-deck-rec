-- The offline evaluation's settings (T058; docs/roadmap/scoring-design.md, "Evaluation"), in app_config.scoring.eval:
-- the holdout split, what each test hides or plants, and the gate. `cli eval:holdout` is the only reader.
--
-- seed fixes the split, the hidden cards and every bootstrap resample. stapleBaselineRate decides which hits count as
-- generic staples for the "Sol Ring rate", and solRingTolerance is how far that rate may rise before a change fails.
-- Both are starting values the evaluation's own reports retune (owner, 2026-10-05).

update public.app_config
   set value = value || jsonb_build_object('eval', $json${
     "seed": 20261006,
     "holdoutShare": 0.1,
     "hiddenCards": 10,
     "recallAt": 20,
     "injectedCuts": 10,
     "cutPrecisionAt": 10,
     "bootstrapResamples": 1000,
     "stapleBaselineRate": 0.25,
     "solRingTolerance": 0.02,
     "bucketMinDecks": [50, 10],
     "simulatedDecks": [0, 5, 10, 20],
     "simulateFromDecks": 50,
     "collectionExtraCards": 300,
     "edhrecTop": 50
   }$json$::jsonb),
       updated_at = now()
 where key = 'scoring'
   and not value ? 'eval';
