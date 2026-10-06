import { describe, expect, it } from 'vitest';
import { parseCorpusSettings, parseScoringConfig } from './config';
import { TEST_CORPUS_SETTINGS, TEST_SCORING } from './test-config';

describe('scoring config', () => {
  it('reads app_config.scoring as the migration seeds it', () => {
    expect(parseScoringConfig(JSON.parse(JSON.stringify(TEST_SCORING)))).toEqual(TEST_SCORING);
  });

  it('refuses a missing row or key rather than falling back to numbers in code', () => {
    expect(() => parseScoringConfig(null)).toThrow(/app_config.scoring/);
    const { cuts: _cuts, ...withoutCuts } = TEST_SCORING;
    expect(() => parseScoringConfig(withoutCuts)).toThrow(/app_config.scoring/);
  });

  it('refuses a weight outside 0..1', () => {
    const broken = { ...TEST_SCORING, weights: { ...TEST_SCORING.weights, add: { ...TEST_SCORING.weights.add, corpus: 8 } } };
    expect(() => parseScoringConfig(broken)).toThrow(/app_config.scoring/);
  });

  it("reads app_config.corpus's scoring settings and ignores the other jobs' keys", () => {
    expect(parseCorpusSettings({ ...TEST_CORPUS_SETTINGS, collateMaxRemovedShare: 0.1, maxUnresolvedCards: 3 })).toEqual(TEST_CORPUS_SETTINGS);
    const { severeSynergyScore: _severe, ...withoutSevere } = TEST_CORPUS_SETTINGS;
    expect(() => parseCorpusSettings(withoutSevere)).toThrow(/app_config.corpus/);
  });
});
