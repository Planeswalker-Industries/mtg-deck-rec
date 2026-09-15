import type { CorpusConfidence } from '../contract';

/** Deck counts where a commander's own decks start to count (minDecks) and get full weight (fullDecks). */
export interface CorpusThresholds {
  minDecks: number;
  fullDecks: number;
}

/** How a commander's decks play a card: inclusion shrunk toward the baseline, and how far above the baseline it is. */
export interface CommanderCardRate {
  inclusion: number;
  synergy: number;
}

/** Synergy this far above the baseline (30 points) scores as fully commander-specific. */
const SYNERGY_SCALE = 0.3;
/** With only baseline play rates, the corpus component keeps this share of its weight. */
export const BASELINE_CORPUS_WEIGHT = 0.5;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

/** Inclusion shrunk toward the card's baseline rate, (x + α·p0) / (n + α), so a few decks can't swing it. */
export function shrunkInclusion(decksWith: number, deckCount: number, baseline: number, alpha: number): number {
  return (decksWith + alpha * baseline) / (deckCount + alpha);
}

/**
 * Decks last updated in or after the card's release month ('YYYY-MM'; null counts every deck). A deck last touched
 * before a card existed says nothing about whether players run it.
 */
export function decksSinceRelease(deckMonths: Readonly<Record<string, number>>, releaseMonth: string | null): number {
  let total = 0;
  for (const [month, count] of Object.entries(deckMonths)) {
    if (releaseMonth === null || month >= releaseMonth) total += count;
  }
  return total;
}

/**
 * 0..1 score from a commander's decks. Mostly synergy (cards this commander's decks run more than decks in general),
 * partly inclusion, so proven staples still score: 0.6·(0.5 + 0.5·clip(synergy / 0.3)) + 0.4·√inclusion.
 */
export function commanderCorpusScore({ inclusion, synergy }: CommanderCardRate): number {
  return clamp01(0.6 * (0.5 + 0.5 * clamp(synergy / SYNERGY_SCALE, -1, 1)) + 0.4 * Math.sqrt(clamp01(inclusion)));
}

/** 0..1 score from how widely the card is played in decks whose color identity allows it. */
export function baselineCorpusScore(baseline: number): number {
  return Math.sqrt(clamp01(baseline));
}

/** Share of the corpus signal taken from the commander's own decks: 0 below minDecks, rising to 1 at fullDecks. */
export function commanderShare(deckCount: number, { minDecks, fullDecks }: CorpusThresholds): number {
  if (deckCount < minDecks) return 0;
  if (fullDecks <= minDecks) return 1;
  return clamp01((deckCount - minDecks) / (fullDecks - minDecks));
}

export function corpusConfidence(deckCount: number, { minDecks, fullDecks }: CorpusThresholds): CorpusConfidence {
  if (deckCount >= fullDecks) return 'full';
  if (deckCount >= minDecks) return 'low';
  return 'none';
}

/** A commander key (one commander or a partner pair) and its corpus decks. */
export interface CorpusKey {
  id: number;
  /** The lower card id of a pair. */
  commander1: number;
  commander2: number | null;
  /** Color identity bitmask of the key's commanders. */
  identity: number;
  deckCount: number;
  /** Decks by last-updated month ('YYYY-MM'). */
  deckMonths: Readonly<Record<string, number>>;
}

/** A key whose decks count for a deck: its own commanders' key at full weight, or a borrowed key at a reduced weight. */
export interface CorpusSource extends CorpusKey {
  weight: number;
  borrowed: boolean;
}

export interface CorpusSources {
  /** The key for exactly these commanders, when it has decks. */
  own: CorpusKey | null;
  sources: CorpusSource[];
  ownDeckCount: number;
  borrowedDeckCount: number;
  /** Own decks plus borrowed decks at their weight: the count confidence and the commander share are judged on. */
  effectiveDeckCount: number;
}

export interface PoolSettings {
  minDecks: number;
  /** Weight of each borrowed deck relative to one of the commanders' own decks (0 turns borrowing off). */
  partnerPoolWeight: number;
}

const involves = (key: CorpusKey, ids: readonly number[]) => ids.includes(key.commander1) || (key.commander2 !== null && ids.includes(key.commander2));

/**
 * Which commander keys' decks describe a deck with these commanders. Their own key stands alone once it has minDecks.
 * Below that, every other key led by one of these commanders (a partner's solo decks, its other pairings) is borrowed
 * at `partnerPoolWeight`: partners split their decks across many pairings, so most pairs never reach minDecks alone.
 */
export function pickCorpusSources(commanderIds: readonly number[], keys: readonly CorpusKey[], settings: PoolSettings): CorpusSources {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const withDecks = ids.length > 0 && ids.length <= 2 ? keys.filter((k) => k.deckCount > 0 && involves(k, ids)) : [];
  const own = withDecks.find((k) => k.commander1 === ids[0] && k.commander2 === (ids[1] ?? null)) ?? null;
  const weight = clamp01(settings.partnerPoolWeight);

  const sources: CorpusSource[] = own ? [{ ...own, weight: 1, borrowed: false }] : [];
  if (!(own && own.deckCount >= settings.minDecks) && weight > 0) {
    for (const key of withDecks) if (key !== own) sources.push({ ...key, weight, borrowed: true });
  }
  const ownDeckCount = own?.deckCount ?? 0;
  const borrowed = sources.filter((s) => s.borrowed);
  const borrowedDeckCount = borrowed.reduce((sum, s) => sum + s.deckCount, 0);
  return {
    own,
    sources,
    ownDeckCount,
    borrowedDeckCount,
    effectiveDeckCount: ownDeckCount + borrowed.reduce((sum, s) => sum + s.weight * s.deckCount, 0),
  };
}

/**
 * Decks among the sources that could have run a card, at each source's weight: the key's colors allow the card, and the
 * deck was updated in or after the card's release month.
 */
export function sourceDecksSinceRelease(
  sources: readonly Pick<CorpusSource, 'identity' | 'deckMonths' | 'weight'>[],
  cardIdentity: number,
  releaseMonth: string | null,
): number {
  let total = 0;
  for (const s of sources) {
    if ((cardIdentity & ~s.identity) === 0) total += s.weight * decksSinceRelease(s.deckMonths, releaseMonth);
  }
  return total;
}

/** Confidence in a deck's play rates. Borrowed decks never earn 'full': they come from other pairings, not these commanders. */
export function sourcesConfidence(sources: CorpusSources, thresholds: CorpusThresholds): CorpusConfidence {
  const confidence = corpusConfidence(sources.effectiveDeckCount, thresholds);
  return confidence === 'full' && sources.borrowedDeckCount > 0 ? 'low' : confidence;
}

/**
 * The corpus score component for one card, blending commander and baseline scores by `commanderShare`, and the
 * share of the corpus weight it has earned: half on baseline play rates alone, all of it with enough commander decks.
 * Deck counts are the decks that could have run the card (updated since its release). When too few could have, anywhere,
 * the result is null: an unknown play rate, not a low one (usually a brand-new card).
 */
export function corpusComponent(
  {
    commanderRate,
    commanderDeckCount,
    baseline,
    baselineDeckCount,
  }: { commanderRate: CommanderCardRate | null; commanderDeckCount: number; baseline: number; baselineDeckCount: number },
  thresholds: CorpusThresholds,
): { value: number; weightScale: number } | null {
  const share = commanderRate ? commanderShare(commanderDeckCount, thresholds) : 0;
  if (share === 0 && baselineDeckCount < thresholds.minDecks) return null;
  const fromCommander = commanderRate ? commanderCorpusScore(commanderRate) : 0;
  return {
    value: share * fromCommander + (1 - share) * baselineCorpusScore(baseline),
    weightScale: BASELINE_CORPUS_WEIGHT + (1 - BASELINE_CORPUS_WEIGHT) * share,
  };
}

/** Stand-in when no other candidate has a play-rate score either. */
const DEFAULT_NEUTRAL_CORPUS_VALUE = 0.5;

/**
 * Play-rate score for cards too new to judge (`corpusComponent` returned null): the median of the other candidates'
 * scores. A new card then ranks like a typical option, so what it does and costs decide; being new neither buries it
 * nor promotes it.
 */
export function neutralCorpusValue(knownValues: readonly number[]): number {
  if (knownValues.length === 0) return DEFAULT_NEUTRAL_CORPUS_VALUE;
  const sorted = [...knownValues].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
