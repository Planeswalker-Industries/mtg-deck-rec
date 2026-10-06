import { z } from 'zod';

/**
 * Every scoring weight and threshold, read from the database (T057). The repo is public, so none of these live in code:
 * `app_config.scoring` (private) holds the weights and thresholds below, and `app_config.corpus` the deck-count
 * settings. Both are required: a missing or malformed value is an error, never a silent default, so a typo in the
 * config can't quietly change every recommendation.
 */

const share = z.number().min(0).max(1);
const positive = z.number().positive();

/** One weight per score component (`blendScore` renormalises over the components that have data). */
const componentWeightsSchema = z.object({
  tag: share,
  manaValue: share,
  staple: share,
  corpus: share,
  votes: share,
  role: share,
});

export const scoringConfigSchema = z.object({
  weights: z.object({
    /** Cards to add (and commander pages): play rates and role gaps. */
    add: componentWeightsSchema,
    swap: z.object({
      /** Swaps with no collection, or with one in 'first' mode. Their tag, staple and mana value weights also order the stored swap pool. */
      collection_less: componentWeightsSchema,
      /** Swaps limited to owned cards: an owned replacement has to do the same job. */
      collection_aware: componentWeightsSchema,
    }),
  }),
  corpus: z.object({
    /** Synergy this far above the colour baseline scores as fully commander-specific. */
    synergyScale: positive,
    /** The commander score's share from synergy; the rest is √inclusion, so proven staples still score. */
    synergyShare: share,
    /** The corpus component's weight earned from baseline play rates alone. */
    baselineWeight: share,
    /** A card too new to judge scores as the candidates' median, or this when none has a score. */
    neutralValue: share,
  }),
  swap: z.object({
    /** Candidates below this tag similarity don't do the same job. */
    tagSimilarityFloor: share,
    /** A pair's votes reach half their weight at this many votes. */
    voteHalfWeightCount: positive,
    /** Mana value proximity is exp(−|difference| / this). */
    manaValueFalloff: positive,
  }),
  cuts: z.object({
    /** A role is overloaded once the deck runs this many times its target. */
    roleOverloadRatio: positive,
    /** Nonland cards at or above this mana value are flagged as expensive. */
    highManaValue: positive,
    /** Below this play-rate score a card is low synergy. */
    lowSynergyScore: share,
    /** At or above this play-rate score the commander's decks clearly run the card. */
    wellPlayedScore: share,
    /** Optional cuts stay below rule problems, which score 1. */
    optionalCutCap: share,
    /** An optional cut's score with play rates: (1 − play rate), role overload and relative mana value. */
    withCorpus: z.object({ corpus: share, role: share, manaValue: share }),
    /** Without play rates: overloaded-role cards first, then expensive cards, each lifted by relative mana value. */
    withoutCorpus: z.object({ redundantBase: share, redundantManaValue: share, base: share, manaValue: share }),
  }),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type CorpusScoring = ScoringConfig['corpus'];
export type SwapScoring = ScoringConfig['swap'];
export type CutScoring = ScoringConfig['cuts'];

/**
 * The deck-count settings in `app_config.corpus` that scoring reads (the collator's and the aggregate's own keys sit
 * beside them and are ignored here).
 */
export const corpusSettingsSchema = z.object({
  /** α in (x + α·p0) / (n + α). */
  shrinkAlpha: positive,
  /** A commander's own decks start to count here… */
  minDecks: z.number().int().min(0),
  /** …and get full weight here. */
  fullDecks: z.number().int().min(0),
  /** Weight of each borrowed deck against one of the commanders' own. */
  partnerPoolWeight: share,
  /** EDHREC's prior share (T061 replaces it). */
  externalPriorShare: share,
  /** Below this play-rate score a cut is mandatory rather than a suggestion. */
  severeSynergyScore: share,
});

export type CorpusSettings = z.infer<typeof corpusSettingsSchema>;

/** `app_config.corpus`, validated. Throws on a missing or malformed value. */
export function parseCorpusSettings(value: unknown): CorpusSettings {
  const parsed = corpusSettingsSchema.safeParse(value);
  if (!parsed.success) throw new Error(`app_config.corpus is missing or malformed: ${parsed.error.message}`);
  return parsed.data;
}

/** `app_config.scoring`, validated. Throws on a missing or malformed value. */
export function parseScoringConfig(value: unknown): ScoringConfig {
  const parsed = scoringConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error(`app_config.scoring is missing or malformed: ${parsed.error.message}`);
  return parsed.data;
}
