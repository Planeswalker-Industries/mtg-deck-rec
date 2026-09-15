import { describe, expect, it } from 'vitest';
import {
  BASELINE_CORPUS_WEIGHT,
  commanderCorpusScore,
  commanderShare,
  corpusComponent,
  corpusConfidence,
  decksSinceRelease,
  neutralCorpusValue,
  pickCorpusSources,
  shrunkInclusion,
  sourceDecksSinceRelease,
  sourcesConfidence,
  type CorpusKey,
} from './corpus';
import { blendScore, SWAP_WEIGHTS } from './swap';

const thresholds = { minDecks: 50, fullDecks: 100 };

describe('shrunkInclusion', () => {
  it('pulls small samples toward the baseline and leaves large ones near their raw rate', () => {
    expect(shrunkInclusion(2, 2, 0.1, 20)).toBeCloseTo((2 + 2) / 22);
    expect(shrunkInclusion(900, 1000, 0.1, 20)).toBeCloseTo(0.884, 2);
  });
});

describe('decksSinceRelease', () => {
  const months = { '2024-05': 10, '2026-03': 5, '2026-04': 7, '2026-08': 3 };

  it('counts only decks updated in or after the release month', () => {
    expect(decksSinceRelease(months, '2026-04')).toBe(10);
    expect(decksSinceRelease(months, '2027-01')).toBe(0);
  });

  it('counts every deck when the release date is unknown', () => {
    expect(decksSinceRelease(months, null)).toBe(25);
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

describe('pickCorpusSources', () => {
  // Card ids: Rograkh 1 (R), Thrasios 2 (UG), Ardenn 3 (W), Liesa 4 (WB).
  const R = 8;
  const W = 1;
  const UG = 2 | 16;
  const key = (id: number, commander1: number, commander2: number | null, identity: number, deckCount: number): CorpusKey => ({
    id,
    commander1,
    commander2,
    identity,
    deckCount,
    deckMonths: { '2026-01': deckCount },
  });
  const keys = [
    key(10, 1, 2, R | UG, 30), // Rograkh + Thrasios
    key(11, 1, 3, R | W, 86), // Rograkh + Ardenn
    key(12, 1, null, R, 2), // Rograkh alone
    key(13, 2, 3, UG | W, 0), // a stale pairing with no decks
    key(14, 4, null, W | 4, 400), // Liesa, unrelated
  ];
  const settings = { minDecks: 50, partnerPoolWeight: 0.25 };

  it('lets a key with enough decks of its own stand alone', () => {
    const picked = pickCorpusSources([3, 1], keys, settings);
    expect(picked.own?.id).toBe(11);
    expect(picked.sources.map((s) => s.id)).toEqual([11]);
    expect(picked.borrowedDeckCount).toBe(0);
    expect(picked.effectiveDeckCount).toBe(86);
  });

  it("borrows a pair's other pairings and solo decks at reduced weight when it has too few", () => {
    const picked = pickCorpusSources([2, 1], keys, settings);
    expect(picked.own?.id).toBe(10);
    expect(picked.sources.map((s) => [s.id, s.weight, s.borrowed])).toEqual([
      [10, 1, false],
      [11, 0.25, true],
      [12, 0.25, true],
    ]);
    expect(picked.ownDeckCount).toBe(30);
    expect(picked.borrowedDeckCount).toBe(88);
    expect(picked.effectiveDeckCount).toBeCloseTo(30 + 0.25 * 88);
  });

  it("gives a single partner commander its pairings' decks", () => {
    const picked = pickCorpusSources([1], keys, settings);
    expect(picked.own?.id).toBe(12);
    expect(picked.borrowedDeckCount).toBe(116);
  });

  it('borrows even when the commanders have no decks together, and never from keys without decks', () => {
    const picked = pickCorpusSources([2, 3], keys, settings);
    expect(picked.own).toBeNull();
    expect(picked.sources.map((s) => s.id)).toEqual([10, 11]);
  });

  it('borrows nothing when the weight is 0', () => {
    expect(pickCorpusSources([1, 2], keys, { ...settings, partnerPoolWeight: 0 }).sources.map((s) => s.id)).toEqual([10]);
  });

  it('counts only weighted decks whose colors allow the card, and caps confidence at low while borrowing', () => {
    const picked = pickCorpusSources([1, 2], keys, settings);
    // A red card fits all three sources; a white card only Rograkh + Ardenn; a blue card only Rograkh + Thrasios.
    expect(sourceDecksSinceRelease(picked.sources, R, null)).toBeCloseTo(30 + 0.25 * 86 + 0.25 * 2);
    expect(sourceDecksSinceRelease(picked.sources, W, null)).toBeCloseTo(0.25 * 86);
    expect(sourceDecksSinceRelease(picked.sources, 2, '2026-02')).toBe(0);
    expect(sourcesConfidence(picked, thresholds)).toBe('low'); // 30 + 0.25 × 88 = 52 decks
    expect(sourcesConfidence({ ...picked, effectiveDeckCount: 40 }, thresholds)).toBe('none');
    expect(sourcesConfidence({ ...picked, effectiveDeckCount: 150 }, thresholds)).toBe('low');
    expect(sourcesConfidence(pickCorpusSources([4], keys, settings), thresholds)).toBe('full');
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
  const rate = { inclusion: 0.5, synergy: 0.4 };

  it('uses the baseline at half weight without enough commander decks', () => {
    const c = corpusComponent({ commanderRate: rate, commanderDeckCount: 10, baseline: 0.25, baselineDeckCount: 5000 }, thresholds);
    expect(c?.value).toBeCloseTo(0.5);
    expect(c?.weightScale).toBe(BASELINE_CORPUS_WEIGHT);
  });

  it('uses the commander score at full weight with enough decks', () => {
    const c = corpusComponent({ commanderRate: rate, commanderDeckCount: 100, baseline: 0.25, baselineDeckCount: 5000 }, thresholds);
    expect(c?.value).toBeCloseTo(commanderCorpusScore(rate));
    expect(c?.weightScale).toBe(1);
  });

  it('has no score when too few decks anywhere could have run the card, instead of a low one', () => {
    const newCard = { commanderRate: { inclusion: 0.02, synergy: -0.05 }, commanderDeckCount: 12, baseline: 0, baselineDeckCount: 30 };
    expect(corpusComponent(newCard, thresholds)).toBeNull();
    expect(corpusComponent({ ...newCard, commanderDeckCount: 80 }, thresholds)).not.toBeNull();
  });

  // Real baselines from the Archidekt spike: Lightning Bolt 8.7% of red decks, Viridian Longbow 0.1% of all decks.
  it('lets play rates separate a staple from a rarely played card with the same tags', () => {
    const weightsFor = (scale: number) => ({ ...SWAP_WEIGHTS.collection_less, corpus: SWAP_WEIGHTS.collection_less.corpus * scale });
    const score = (baseline: number) => {
      const corpus = corpusComponent({ commanderRate: null, commanderDeckCount: 0, baseline, baselineDeckCount: 9000 }, thresholds);
      if (!corpus) throw new Error('expected a corpus score');
      return blendScore(
        { tag: 0.6, manaValue: 0.5, staple: 0.5, corpus: corpus.value, votes: null, role: null },
        weightsFor(corpus.weightScale),
      ).total;
    };
    expect(score(0.087) - score(0.001)).toBeGreaterThan(0.03);
  });
});

describe('neutralCorpusValue', () => {
  it('scores a card too new to judge like the typical candidate beside it', () => {
    expect(neutralCorpusValue([0.2, 0.9, 0.5])).toBe(0.5);
    expect(neutralCorpusValue([0.2, 0.4, 0.6, 0.9])).toBeCloseTo(0.5);
  });

  it('falls back to the middle of the scale when nothing else is known', () => {
    expect(neutralCorpusValue([])).toBe(0.5);
  });
});
