import { describe, expect, it } from 'vitest';
import {
  BASELINE_CORPUS_WEIGHT,
  commanderCorpusScore,
  commanderShare,
  corpusComponent,
  corpusConfidence,
  shrunkInclusion,
} from './corpus';
import { blendScore, SWAP_WEIGHTS } from './swap';

const thresholds = { minDecks: 50, fullDecks: 100 };

describe('shrunkInclusion', () => {
  it('pulls small samples toward the baseline and leaves large ones near their raw rate', () => {
    expect(shrunkInclusion(2, 2, 0.1, 20)).toBeCloseTo((2 + 2) / 22);
    expect(shrunkInclusion(900, 1000, 0.1, 20)).toBeCloseTo(0.884, 2);
  });
});

describe('commanderShare and corpusConfidence', () => {
  it('ignores commander decks below minDecks and ramps to full weight at fullDecks', () => {
    expect(commanderShare(49, thresholds)).toBe(0);
    expect(commanderShare(75, thresholds)).toBeCloseTo(0.5);
    expect(commanderShare(300, thresholds)).toBe(1);
    expect(corpusConfidence(49, thresholds)).toBe('none');
    expect(corpusConfidence(50, thresholds)).toBe('low');
    expect(corpusConfidence(100, thresholds)).toBe('full');
  });
});

describe('commanderCorpusScore', () => {
  it('rises with synergy and inclusion and stays within 0..1', () => {
    const neutral = commanderCorpusScore({ inclusion: 0.2, synergy: 0 });
    expect(commanderCorpusScore({ inclusion: 0.2, synergy: 0.2 })).toBeGreaterThan(neutral);
    expect(commanderCorpusScore({ inclusion: 0.6, synergy: 0 })).toBeGreaterThan(neutral);
    expect(commanderCorpusScore({ inclusion: 2, synergy: 5 })).toBeLessThanOrEqual(1);
    expect(commanderCorpusScore({ inclusion: -1, synergy: -5 })).toBeGreaterThanOrEqual(0);
  });
});

describe('corpusComponent', () => {
  it('uses the baseline at half weight without enough commander decks', () => {
    const c = corpusComponent({ commanderRate: { inclusion: 0.5, synergy: 0.4 }, commanderDeckCount: 10, baseline: 0.25 }, thresholds);
    expect(c.value).toBeCloseTo(0.5);
    expect(c.weightScale).toBe(BASELINE_CORPUS_WEIGHT);
  });

  it('uses the commander score at full weight with enough decks', () => {
    const rate = { inclusion: 0.5, synergy: 0.4 };
    const c = corpusComponent({ commanderRate: rate, commanderDeckCount: 100, baseline: 0.25 }, thresholds);
    expect(c.value).toBeCloseTo(commanderCorpusScore(rate));
    expect(c.weightScale).toBe(1);
  });

  // Real baselines from the Archidekt spike: Lightning Bolt 8.7% of red decks, Viridian Longbow 0.1% of all decks.
  it('lets play rates separate a staple from a rarely played card with the same tags', () => {
    const weightsFor = (scale: number) => ({ ...SWAP_WEIGHTS.collection_less, corpus: SWAP_WEIGHTS.collection_less.corpus * scale });
    const score = (baseline: number) => {
      const corpus = corpusComponent({ commanderRate: null, commanderDeckCount: 0, baseline }, thresholds);
      return blendScore({ tag: 0.6, manaValue: 0.5, staple: 0.5, corpus: corpus.value, votes: null }, weightsFor(corpus.weightScale)).total;
    };
    expect(score(0.087) - score(0.001)).toBeGreaterThan(0.03);
  });
});
