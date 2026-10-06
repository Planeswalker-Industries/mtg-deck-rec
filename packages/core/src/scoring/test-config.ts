import type { CorpusSettings, ScoringConfig } from './config';

/**
 * Tests only: the scoring settings as `20261006000300_scoring_config.sql` seeds `app_config.scoring` and as hosted's
 * `app_config.corpus` held them on 2026-10-06. The app and the worker read the database, never these; not exported
 * from the package.
 */
export const TEST_SCORING: ScoringConfig = {
  weights: {
    add: { tag: 0, manaValue: 0, staple: 0, corpus: 0.8, votes: 0, role: 0.2 },
    swap: {
      collection_less: { tag: 0.4, manaValue: 0.1, staple: 0.2, corpus: 0.2, votes: 0.1, role: 0 },
      collection_aware: { tag: 0.55, manaValue: 0.1, staple: 0.1, corpus: 0.15, votes: 0.1, role: 0 },
    },
  },
  corpus: { synergyScale: 0.3, synergyShare: 0.6, baselineWeight: 0.5, neutralValue: 0.5 },
  swap: { tagSimilarityFloor: 0.25, voteHalfWeightCount: 25, manaValueFalloff: 1.5 },
  cuts: {
    roleOverloadRatio: 1.25,
    highManaValue: 6,
    lowSynergyScore: 0.35,
    wellPlayedScore: 0.5,
    optionalCutCap: 0.95,
    withCorpus: { corpus: 0.5, role: 0.3, manaValue: 0.2 },
    withoutCorpus: { redundantBase: 0.5, redundantManaValue: 0.4, base: 0.3, manaValue: 0.2 },
  },
};

export const TEST_CORPUS_SETTINGS: CorpusSettings = {
  shrinkAlpha: 20,
  minDecks: 50,
  fullDecks: 100,
  partnerPoolWeight: 0.25,
  externalPriorShare: 0,
  severeSynergyScore: 0.2,
};
