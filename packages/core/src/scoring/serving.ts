import type { CorpusEvidence } from '../contract';
import {
  commanderCorpusScore,
  commanderShare,
  corpusComponent,
  decksSinceRelease,
  shrunkInclusion,
  type CommanderCardRate,
  type CorpusSource,
  type CorpusThresholds,
  type PoolSettings,
} from './corpus';

/**
 * Precomputed play rates (T055). The precompute worker stores, per commander (or pair) and card, the counts below; the
 * request turns them back into the rates `corpusComponent` scores. Both sides call these functions, so a stored row and
 * a card scored at request time (one no source deck ran) come out of the same arithmetic.
 */

/** Colour identities are 5-bit masks. */
export const IDENTITY_COUNT = 32;

export interface ServingSettings extends CorpusThresholds, PoolSettings {
  shrinkAlpha: number;
}

/**
 * Used for any key app_config.corpus lacks; the web app and the precompute worker read the settings through
 * `servingSettings`, so both fall back to the same numbers. externalPriorShare 0 keeps the EDHREC prior off.
 */
export const DEFAULT_SERVING_SETTINGS: Readonly<Required<ServingSettings>> = {
  shrinkAlpha: 20,
  minDecks: 50,
  fullDecks: 100,
  partnerPoolWeight: 0.25,
  externalPriorShare: 0,
};

/** The scoring settings in app_config.corpus, each missing or malformed key replaced by its default. */
export function servingSettings(value: unknown): Required<ServingSettings> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const read = (key: keyof ServingSettings) => {
    const v = raw[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_SERVING_SETTINGS[key];
  };
  return {
    shrinkAlpha: read('shrinkAlpha'),
    minDecks: read('minDecks'),
    fullDecks: read('fullDecks'),
    partnerPoolWeight: read('partnerPoolWeight'),
    externalPriorShare: read('externalPriorShare'),
  };
}

/** One commander key's counts for one card: a `commander_card_stats` row. */
export interface KeyCardCount {
  keyId: number;
  decksWith: number;
  /** The key's decks updated since the card's release, as the aggregate counted them; null on older rows. */
  eligibleDecks: number | null;
}

export interface CardFacts {
  identity: number;
  /** 'YYYY-MM' of the card's first printing; null counts every deck. */
  releaseMonth: string | null;
}

/** Weighted sums over the source keys that ran a card. */
export interface RowSums {
  decksWith: number;
  /** Decks among those keys last updated before the card came out. */
  tooEarly: number;
}

/** A card's counts under one commander or pair, each source key at its weight. */
export interface CommanderCardCounts {
  /** Decks that ran the card. */
  decksWith: number;
  /** Decks that could have run it: sources whose colours allow it, updated since its release. What the request scores. */
  commanderDecks: number;
  /**
   * The add pool's count, as the retired `rec_add_candidates` made it: every deck of the sources whose colours allow the card, less
   * the decks too early for it among the keys that ran it. It differs from `commanderDecks` for keys that never ran the
   * card, whose older decks it still counts. Kept as it was, so the pool holds the same cards (T055 parity).
   */
  poolDecks: number;
}

/** Sums one commander's per-key rows for a card, each key at its source weight. Rows for keys outside the sources count nothing. */
export function keyRowSums(sources: readonly CorpusSource[], rows: readonly KeyCardCount[]): RowSums {
  const byKey = new Map(sources.map((s) => [s.id, s]));
  let decksWith = 0;
  let tooEarly = 0;
  for (const row of rows) {
    const source = byKey.get(row.keyId);
    if (!source) continue;
    decksWith += source.weight * row.decksWith;
    tooEarly += source.weight * (source.deckCount - (row.eligibleDecks ?? source.deckCount));
  }
  return { decksWith, tooEarly };
}

/**
 * A commander card's totals over every key it leads or shares, at full weight: `partner_card_totals`. A pair no key
 * knows borrows every such key at `partnerPoolWeight` (`pickCorpusSources`), and no key holds both partners, so the
 * pair's sums are the two partners' totals at that weight.
 */
export function partnerRowSums(totals: readonly (RowSums | undefined)[], weight: number): RowSums {
  let decksWith = 0;
  let tooEarly = 0;
  for (const t of totals) {
    if (!t) continue;
    decksWith += weight * t.decksWith;
    tooEarly += weight * t.tooEarly;
  }
  return { decksWith, tooEarly };
}

/**
 * The sources' decks that a card's colours allow: all of them, and those updated since its release. They depend only
 * on the card's identity and release month, so a caller scoring many cards can keep them per pair of those.
 */
export interface SourceDeckTotals {
  sinceRelease: number;
  allDecks: number;
}

export function sourceDeckTotals(sources: readonly CorpusSource[], card: CardFacts): SourceDeckTotals {
  let sinceRelease = 0;
  let allDecks = 0;
  for (const s of sources) {
    if ((card.identity & ~s.identity) !== 0) continue;
    sinceRelease += s.weight * decksSinceRelease(s.deckMonths, card.releaseMonth);
    allDecks += s.weight * s.deckCount;
  }
  return { sinceRelease, allDecks };
}

/** A card's counts from its sources' deck totals and its row sums. A card no source ran passes zero sums. */
export function countsFromTotals(totals: SourceDeckTotals, sums: RowSums): CommanderCardCounts {
  return {
    decksWith: sums.decksWith,
    commanderDecks: Math.max(totals.sinceRelease, sums.decksWith),
    poolDecks: Math.max(totals.allDecks - sums.tooEarly, sums.decksWith),
  };
}

export function commanderCardCounts(sources: readonly CorpusSource[], card: CardFacts, sums: RowSums): CommanderCardCounts {
  return countsFromTotals(sourceDeckTotals(sources, card), sums);
}

/** Weighted decks of the sources whose colours allow a card of each identity (index = identity mask). */
export function identityPoolDecks(sources: readonly CorpusSource[]): number[] {
  return Array.from({ length: IDENTITY_COUNT }, (_, identity) =>
    sources.reduce((sum, s) => ((identity & ~s.identity) === 0 ? sum + s.weight * s.deckCount : sum), 0),
  );
}

/** The add pool's order (`pool_score`, as the retired `rec_add_candidates` ranked it): the commander-specific score over `poolDecks`. */
export function addPoolScore(counts: Pick<CommanderCardCounts, 'decksWith' | 'poolDecks'>, baseline: number, alpha: number): number {
  const inclusion = shrunkInclusion(counts.decksWith, counts.poolDecks, baseline, alpha);
  return commanderCorpusScore({ inclusion, synergy: inclusion - baseline });
}

/** Decks of every identity that allows the card, updated since its release: the baseline's count for a card no deck runs. */
export function identityBaselineDecks(
  monthsByIdentity: ReadonlyMap<number, Readonly<Record<string, number>>>,
  card: CardFacts,
): number {
  let total = 0;
  for (let deckIdentity = 0; deckIdentity < IDENTITY_COUNT; deckIdentity++) {
    if ((card.identity & ~deckIdentity) === 0) total += decksSinceRelease(monthsByIdentity.get(deckIdentity) ?? {}, card.releaseMonth);
  }
  return total;
}

/** A card's baseline: its rate over every deck its colours allow, and how many decks that was. */
export interface BaselineCounts {
  rate: number;
  decksWith: number;
  /** `card_global_stats.eligible_decks`, or `identityBaselineDecks` for a card no deck runs. */
  eligibleDecks: number;
}

/** What `corpusComponent` scores a card on, and the evidence shown with it. */
export interface ServedCardRates {
  baseline: number;
  baselineDeckCount: number;
  commanderDeckCount: number;
  commanderRate: CommanderCardRate | null;
  evidence: CorpusEvidence;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A card's rates for one commander from its counts and baseline: the commander's decks shrunk toward the baseline when
 * any could have run the card, the baseline alone otherwise. `pooled` marks evidence counted partly over borrowed decks.
 */
export function servedCardRates(
  counts: Pick<CommanderCardCounts, 'decksWith' | 'commanderDecks'>,
  baseline: BaselineCounts,
  settings: ServingSettings,
  pooled: boolean,
): ServedCardRates {
  // corpusComponent's null case: no usable play rate from the commander's decks or from decks overall.
  const isLimited = (commanderDecks: number) => commanderShare(commanderDecks, settings) === 0 && baseline.eligibleDecks < settings.minDecks;
  if (counts.commanderDecks > 0) {
    const inclusion = shrunkInclusion(counts.decksWith, counts.commanderDecks, baseline.rate, settings.shrinkAlpha);
    return {
      baseline: baseline.rate,
      baselineDeckCount: baseline.eligibleDecks,
      commanderDeckCount: counts.commanderDecks,
      commanderRate: { inclusion, synergy: inclusion - baseline.rate },
      evidence: {
        scope: 'commander',
        decksWith: Math.round(counts.decksWith),
        commanderDeckCount: Math.round(counts.commanderDecks),
        inclusionRate: round3(counts.decksWith / counts.commanderDecks),
        synergy: round3(inclusion - baseline.rate),
        limited: isLimited(counts.commanderDecks),
        ...(pooled ? { pooled: true } : {}),
      },
    };
  }
  return {
    baseline: baseline.rate,
    baselineDeckCount: baseline.eligibleDecks,
    commanderDeckCount: 0,
    commanderRate: null,
    evidence: {
      scope: 'colors',
      decksWith: baseline.decksWith,
      commanderDeckCount: baseline.eligibleDecks,
      inclusionRate: round3(baseline.rate),
      synergy: 0,
      limited: isLimited(0),
    },
  };
}

/** The stored final corpus score: `corpusComponent` over the served rates (null: too few decks anywhere to judge). */
export function servedCorpusScore(rates: ServedCardRates, settings: ServingSettings): { value: number; weightScale: number } | null {
  return corpusComponent(
    {
      commanderRate: rates.commanderRate,
      commanderDeckCount: rates.commanderDeckCount,
      baseline: rates.baseline,
      baselineDeckCount: rates.baselineDeckCount,
    },
    settings,
  );
}
