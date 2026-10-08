import type { CorpusEvidence } from '../contract';
import type { CorpusScoring } from './config';
import {
  commanderCorpusScore,
  commanderShare,
  corpusComponent,
  decksSinceRelease,
  shrunkInclusion,
  type CommanderCardRate,
  type CorpusSource,
  type CorpusSources,
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
  /** κcap: the most decks the EDHREC prior counts as (0 turns it off). */
  edhrecPriorCap: number;
}

/** A commander's (or pair's) EDHREC page: how many decks it describes and the lowest inclusion it lists. */
export interface EdhrecPage {
  deckCount: number;
  /** The lowest inclusion the page lists: a card it leaves out is played less than this. */
  floor: number;
}

/** A card the page lists: its inclusion there and the decks that could have run it. */
export interface EdhrecListing {
  rate: number;
  potentialDecks: number;
}

/** What a card's commander inclusion is shrunk toward, and how many decks that counts as (T061). */
export interface CardPrior {
  target: number;
  strength: number;
  /** The page lists the card. */
  listed: boolean;
}

/**
 * The EDHREC prior for one card under one commander (scoring-design.md, "`corpus`"): toward the page's rate for a card it
 * lists, with the strength of its potential decks; toward min(p0, floor) for a card it leaves out, with the strength of
 * the page's decks; both capped at `edhrecPriorCap`, so our own decks take over as they grow. Null without a page or
 * with the prior off, which leaves the shrink toward the baseline at alpha.
 */
export function cardPrior(
  page: EdhrecPage | null,
  listing: EdhrecListing | null,
  baselineRate: number,
  settings: Pick<ServingSettings, 'edhrecPriorCap'>,
): CardPrior | null {
  if (!page || settings.edhrecPriorCap <= 0) return null;
  if (listing) return { target: listing.rate, strength: Math.min(listing.potentialDecks, settings.edhrecPriorCap), listed: true };
  return { target: Math.min(baselineRate, page.floor), strength: Math.min(page.deckCount, settings.edhrecPriorCap), listed: false };
}

/** A page's evidence for its commander as a whole, for deciding whether requests draw on the commander's own cards. */
export const pageEvidence = (page: EdhrecPage | null, settings: Pick<ServingSettings, 'edhrecPriorCap'>): number =>
  page && settings.edhrecPriorCap > 0 ? Math.min(page.deckCount, settings.edhrecPriorCap) : 0;

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
 * Whether a commander set is a derived pair (T070): a pair with a key of its own that borrows its partners' other decks,
 * which happens below `minDecks` (`pickCorpusSources`). The precompute worker stores only the first `pairPoolDepth`
 * cards of its add pool (0 turns derivation off), and a request works its counts out with `derivedPairRowSums`.
 */
export const isDerivedPair = (commanderCount: number, picked: Pick<CorpusSources, 'own' | 'borrowedDeckCount'>, pairPoolDepth: number): boolean =>
  pairPoolDepth > 0 && commanderCount === 2 && picked.own !== null && picked.borrowedDeckCount > 0;

/**
 * A keyed pair with fewer than `minDecks` decks of its own (a derived pair): its own key at full weight and every other
 * key of either partner at `partnerPoolWeight` (`pickCorpusSources`). Each partner's `partner_card_totals` already holds
 * the pair's own key, so the borrowed keys are the two totals less the own key twice.
 */
export function derivedPairRowSums(own: RowSums, partnerTotals: readonly (RowSums | undefined)[], weight: number): RowSums {
  const partners = partnerRowSums(partnerTotals, 1);
  return {
    decksWith: own.decksWith + weight * (partners.decksWith - 2 * own.decksWith),
    tooEarly: own.tooEarly + weight * (partners.tooEarly - 2 * own.tooEarly),
  };
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
export function addPoolScore(
  counts: Pick<CommanderCardCounts, 'decksWith' | 'poolDecks'>,
  baseline: number,
  alpha: number,
  scoring: CorpusScoring,
  prior: CardPrior | null = null,
): number {
  const inclusion = shrunkInclusion(counts.decksWith, counts.poolDecks, prior?.target ?? baseline, prior?.strength ?? alpha);
  return commanderCorpusScore({ inclusion, synergy: inclusion - baseline }, scoring);
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
  /** The evidence: the commander's decks that could have run the card, plus the prior's strength. */
  commanderDeckCount: number;
  commanderRate: CommanderCardRate | null;
  /** The commander's EDHREC page lists the card. */
  hasExternalPrior: boolean;
  /** Our own counts only: a score built mostly on EDHREC's numbers never shows them. */
  evidence: CorpusEvidence;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A card's rates for one commander from its counts and baseline: the commander's decks shrunk toward the prior (the
 * EDHREC page's, `cardPrior`) or toward the baseline at alpha, the baseline alone when neither decks nor a page say
 * anything. `pooled` marks evidence counted partly over borrowed decks.
 */
export function servedCardRates(
  counts: Pick<CommanderCardCounts, 'decksWith' | 'commanderDecks'>,
  baseline: BaselineCounts,
  settings: ServingSettings,
  pooled: boolean,
  prior: CardPrior | null = null,
): ServedCardRates {
  // corpusComponent's null case: no usable play rate from the commander's decks or from decks overall.
  const isLimited = (evidence: number) => commanderShare(evidence, settings) === 0 && baseline.eligibleDecks < settings.minDecks;
  const evidenceDecks = counts.commanderDecks + (prior?.strength ?? 0);
  if (counts.commanderDecks > 0 || prior) {
    const inclusion = shrunkInclusion(counts.decksWith, counts.commanderDecks, prior?.target ?? baseline.rate, prior?.strength ?? settings.shrinkAlpha);
    const commanderRate = { inclusion, synergy: inclusion - baseline.rate };
    const listed = prior?.listed ?? false;
    if (counts.commanderDecks === 0) {
      // Only the prior speaks for the commander: the score uses it, the evidence shows the colours' numbers.
      return {
        baseline: baseline.rate,
        baselineDeckCount: baseline.eligibleDecks,
        commanderDeckCount: evidenceDecks,
        commanderRate,
        hasExternalPrior: listed,
        evidence: {
          scope: 'colors',
          decksWith: baseline.decksWith,
          commanderDeckCount: baseline.eligibleDecks,
          inclusionRate: round3(baseline.rate),
          synergy: 0,
          limited: isLimited(evidenceDecks) && !listed,
        },
      };
    }
    return {
      baseline: baseline.rate,
      baselineDeckCount: baseline.eligibleDecks,
      commanderDeckCount: evidenceDecks,
      commanderRate,
      hasExternalPrior: listed,
      evidence: {
        scope: 'commander',
        decksWith: Math.round(counts.decksWith),
        commanderDeckCount: Math.round(counts.commanderDecks),
        inclusionRate: round3(counts.decksWith / counts.commanderDecks),
        synergy: round3(inclusion - baseline.rate),
        limited: isLimited(evidenceDecks),
        ...(pooled ? { pooled: true } : {}),
      },
    };
  }
  return {
    baseline: baseline.rate,
    baselineDeckCount: baseline.eligibleDecks,
    commanderDeckCount: 0,
    commanderRate: null,
    hasExternalPrior: false,
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
export function servedCorpusScore(
  rates: ServedCardRates,
  settings: ServingSettings,
  scoring: CorpusScoring,
): { value: number; weightScale: number } | null {
  return corpusComponent(
    {
      commanderRate: rates.commanderRate,
      commanderDeckCount: rates.commanderDeckCount,
      baseline: rates.baseline,
      baselineDeckCount: rates.baselineDeckCount,
      hasExternalPrior: rates.hasExternalPrior,
    },
    settings,
    scoring,
  );
}
