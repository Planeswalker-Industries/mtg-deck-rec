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
  /** Collection mode (T059): the buy list beside suggestions limited to what the collection supplies. */
  collection: z.object({
    /** An unowned card joins the buy list when it scores this much above the best card the collection supplies for the slot. */
    buyMargin: share,
    /** The buy list ranks by gain per dollar with prices under this counted as this, so bulk cards don't divide by almost nothing. */
    priceFloorUsd: positive,
    /** How many cards a buy list holds. */
    buyListSize: z.int().min(0),
  }),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

/**
 * The offline evaluation's settings (`app_config.scoring.eval`, T058): the holdout split, what each test hides or adds,
 * and the gate. Only the evaluation reads them.
 */
export const evalConfigSchema = z.object({
  /** Fixes the split, the hidden cards and every resample, so two runs compare like with like. */
  seed: z.number().int(),
  /** Share of collated decks held out. */
  holdoutShare: share,
  /** Nonland cards hidden from each held-out deck. */
  hiddenCards: z.number().int().positive(),
  /** Adds are graded on their top this many. */
  recallAt: z.number().int().positive(),
  /** Cards from other commanders' decks added to each held-out deck for the cut test. */
  injectedCuts: z.number().int().positive(),
  /** Cuts are graded on their top this many. */
  cutPrecisionAt: z.number().int().positive(),
  /** Resamples over commanders for the bootstrap intervals. */
  bootstrapResamples: z.number().int().positive(),
  /** A hit whose baseline rate is at least this is a generic staple (the "Sol Ring rate"). */
  stapleBaselineRate: share,
  /** The most the Sol Ring rate may rise before a change fails the gate. */
  solRingTolerance: share,
  /** Commanders are bucketed by their own training decks: at least the first, at least the second, fewer. */
  bucketMinDecks: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Simulated small commanders keep only this many of their training decks… */
  simulatedDecks: z.array(z.number().int().min(0)).min(1),
  /** …and are drawn from commanders with at least this many. */
  simulateFromDecks: z.number().int().positive(),
  /** Collection test: owned cards besides the hidden ones, drawn by popularity. */
  collectionExtraCards: z.number().int().min(0),
  /** EDHREC agreement compares the top this many by our corpus score and by EDHREC's inclusion. */
  edhrecTop: z.number().int().positive(),
});

export type EvalConfig = z.infer<typeof evalConfigSchema>;

/** `app_config.scoring.eval`, validated. Throws on a missing or malformed value. */
export function parseEvalConfig(value: unknown): EvalConfig {
  const parsed = evalConfigSchema.safeParse(value);
  if (!parsed.success) throw new Error(`app_config.scoring.eval is missing or malformed: ${parsed.error.message}`);
  return parsed.data;
}
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
  /**
   * The most decks EDHREC's prior counts as (κcap, T061): a listed card's prior weighs its page's potential decks up to
   * this, so our own decks take over as they grow. 0 turns the prior off.
   */
  edhrecPriorCap: z.number().min(0),
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
