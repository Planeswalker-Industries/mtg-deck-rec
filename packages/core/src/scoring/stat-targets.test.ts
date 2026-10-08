import { describe, expect, it } from 'vitest';
import type { BracketRules } from '../formats/commander/bracket';
import { statTargetsFor } from './stat-targets';
import type { RankCorpus } from './rank';

const rules: BracketRules = {
  massLandDenialTagIds: ['t1'],
  extraTurnTagIds: ['t2'],
  massLandDenialFromBracket: 4,
  maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 },
  extraTurnLoopResults: ['Infinite turns'],
  extraTurnLoopFromBracket: 4,
};

type StatCorpus = RankCorpus & { ownDeckCount: number; borrowedDeckCount: number };

const corpus = (decks: number, over: Partial<StatCorpus> = {}): StatCorpus => ({
  // Only the thresholds matter here: share 0 under 20 decks, rising to 1 at 100.
  settings: { minDecks: 20, fullDecks: 100 } as RankCorpus['settings'],
  confidence: 'full',
  ownDeckCount: decks,
  borrowedDeckCount: 0,
  effectiveDeckCount: decks,
  roleProfile: { ramp: 12 },
  curveProfile: { '1': 9, '2': 19, '3': 15 },
  prior: { roles: { ramp: 99 }, curve: {}, evidence: 5000 } as RankCorpus['prior'],
  landCount: 33,
  basicLandCount: 20,
  ...over,
});

const input = (c: StatCorpus | null) => ({
  corpus: c,
  genericRoles: [{ roleId: 'ramp', label: 'Ramp', target: 10 }],
  typicalCurve: { '0': 0.1, '1': 8, '2': 12, '3': 11, '4': 8, '5': 6, '6': 3, '7': 2 },
  build: { landCounts: [32, 35, 36, 37, 38, 38], basicLandCounts: [30, 32, 20, 12, 8, 5] },
  colourCount: 2,
  bracketRules: rules,
  commanderLabel: 'Liesa',
});

describe('statTargetsFor', () => {
  it('uses the commander alone at full share', () => {
    const t = statTargetsFor(input(corpus(102)));
    expect(t.source).toBe('commander');
    expect(t.label).toBe('Liesa decks (102)');
    expect(t.lands).toBe(33);
    expect(t.roles[0]!.target).toBe(12);
    expect(t.curve).toEqual([0, 9, 19, 15, 0, 0, 0, 0]); // a commander's missing bucket is 0
  });
  it('uses typical decks without a corpus', () => {
    const t = statTargetsFor(input(null));
    expect(t.source).toBe('typical');
    expect(t.label).toBe('Typical decks');
    expect(t.lands).toBe(36);
    expect(t.basicLands).toBe(20);
    expect(t.roles[0]!.target).toBe(10);
    expect(t.curve[2]).toBe(12);
  });
  it('blends between the thresholds', () => {
    const t = statTargetsFor(input(corpus(60))); // share 0.5
    expect(t.source).toBe('blended');
    expect(t.label).toBe('Liesa decks (60), filled out with typical decks');
    expect(t.lands).toBe(34.5);
    expect(t.roles[0]!.target).toBe(11);
  });
  it('names own decks only, and says when partner decks were borrowed', () => {
    // 40 own decks and 80 borrowed at 0.25: 60 effective, share 0.5.
    const pooled = corpus(60, { ownDeckCount: 40, borrowedDeckCount: 80 });
    const t = statTargetsFor({ ...input(pooled), commanderLabel: 'Tymna & Thrasios' });
    expect(t.source).toBe('blended');
    expect(t.label).toBe('Tymna & Thrasios decks (40) with partner decks, filled out with typical decks');
    expect(t.lands).toBe(34.5); // the blend still reads the effective count
    const full = statTargetsFor({ ...input(corpus(120, { ownDeckCount: 70, borrowedDeckCount: 200 })), commanderLabel: 'Tymna & Thrasios' });
    expect(full.label).toBe('Tymna & Thrasios decks (70) with partner decks');
  });
  it('never reads the EDHREC prior', () => {
    expect(statTargetsFor(input(corpus(102))).roles[0]!.target).not.toBe(99);
  });
  it('drops the tag ids from the bracket limits', () => {
    expect(statTargetsFor(input(null)).bracketLimits).toEqual({
      massLandDenialFromBracket: 4,
      maxExtraTurnCards: { '1': 0, '2': 2, '3': 2 },
      extraTurnLoopResults: ['Infinite turns'],
      extraTurnLoopFromBracket: 4,
    });
  });
});
