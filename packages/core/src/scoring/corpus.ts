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

/**
 * The corpus score component for one card, blending commander and baseline scores by `commanderShare`, and the
 * share of the corpus weight it has earned: half on baseline play rates alone, all of it with enough commander decks.
 */
export function corpusComponent(
  { commanderRate, commanderDeckCount, baseline }: { commanderRate: CommanderCardRate | null; commanderDeckCount: number; baseline: number },
  thresholds: CorpusThresholds,
): { value: number; weightScale: number } {
  const share = commanderRate ? commanderShare(commanderDeckCount, thresholds) : 0;
  const fromCommander = commanderRate ? commanderCorpusScore(commanderRate) : 0;
  return {
    value: share * fromCommander + (1 - share) * baselineCorpusScore(baseline),
    weightScale: BASELINE_CORPUS_WEIGHT + (1 - BASELINE_CORPUS_WEIGHT) * share,
  };
}
