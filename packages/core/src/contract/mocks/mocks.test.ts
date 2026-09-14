import { describe, expect, it } from 'vitest';
import type { DeckAnalysis } from '../decks';
import type { CardId } from '../ids';
import type { RecContext } from '../recs';
import { createMockApis, mockCards, mockDecklistText } from './index';

const idOf = (name: string): CardId => {
  const card = mockCards.find((c) => c.name === name);
  if (!card) throw new Error(`fixture missing: ${name}`);
  return card.id;
};

const setup = async () => {
  const apis = createMockApis({ latencyMs: 0 });
  const parsed = await apis.actions.parseDeck({ text: mockDecklistText });
  if (!parsed.ok || !parsed.data.analysis) throw new Error('mock decklist failed to parse');
  const analysis: DeckAnalysis = parsed.data.analysis;
  const context = (overrides: Partial<RecContext> = {}): RecContext => ({
    deck: analysis.deck,
    bracket: analysis.estimatedBracket,
    bracketSource: 'inferred',
    includeGameChangers: true,
    ownership: null,
    ...overrides,
  });
  return { apis, analysis, context };
};

describe('mock parseDeck', () => {
  it('resolves the sample deck and analyzes it', async () => {
    const { analysis } = await setup();
    expect(analysis.deck.commanders).toEqual([idOf('Chulane, Teller of Tales')]);
    expect(analysis.colorIdentity).toBe('WUG');
    expect(analysis.gameChangerIds).toEqual([idOf('Cyclonic Rift'), idOf('Rhystic Study')]);
    expect(analysis.estimatedBracket).toBe(3);
    expect(analysis.issues.map((i) => i.code)).toContain('OUTSIDE_COLOR_IDENTITY');
  });

  it('flags unknown cards as unresolved and withholds analysis', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const r = await apis.actions.parseDeck({ text: 'Commander\n1 Chulane, Teller of Tales\n\nDeck\n1 Not A Real Card' });
    expect(r.ok && r.data.analysis).toBe(null);
    expect(r.ok && r.data.lines[1]?.resolution.status).toBe('unresolved');
  });
});

describe('mock swap', () => {
  it('returns gated, sorted, bounded suggestions in collection-less mode', async () => {
    const { apis, context } = await setup();
    const r = await apis.recs.swap({ context: context(), targetCardId: idOf('Swords to Plowshares') });
    if (!r.ok) throw new Error(r.error.message);
    const names = r.data.suggestions.map((s) => s.card.name);
    expect(r.data.mode).toBe('collection_less');
    expect(names).toContain('Path to Exile');
    expect(names).not.toContain('Lightning Bolt'); // outside color identity and already in deck
    const totals = r.data.suggestions.map((s) => s.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    for (const s of r.data.suggestions) {
      expect(s.score.total).toBeGreaterThanOrEqual(0);
      expect(s.score.total).toBeLessThanOrEqual(1);
      expect(s.score.components.tag).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('gives unvoted pairs the prior, not zero, and no vote weight', async () => {
    const { apis, context } = await setup();
    const r = await apis.recs.swap({ context: context(), targetCardId: idOf('Swords to Plowshares') });
    if (!r.ok) throw new Error(r.error.message);
    const first = r.data.suggestions[0];
    expect(first?.votes.voteCount).toBe(0);
    expect(first?.votes.score).toBe(0.5);
    expect(first?.score.effectiveWeights.votes).toBe(0);
  });

  it('excludes game changers when the toggle is off', async () => {
    const { apis, context } = await setup();
    const r = await apis.recs.swap({ context: context({ includeGameChangers: false }), targetCardId: idOf('Counterspell') });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.suggestions.every((s) => !s.card.gameChanger)).toBe(true);
  });

  it('restricts to owned cards and prices the swap as a saving', async () => {
    const { apis, context } = await setup();
    const ownership = { kind: 'session' as const, catalogEpoch: 'mock-1', ownedCardIds: [idOf('Generous Gift')] };
    const r = await apis.recs.swap({ context: context({ ownership }), targetCardId: idOf('Swords to Plowshares') });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.mode).toBe('collection_aware');
    expect(r.data.suggestions.map((s) => s.card.name)).toEqual(['Generous Gift']);
    expect(r.data.suggestions[0]?.costDelta).toMatchObject({ basis: 'owned_replacement', usd: -1.52 });
  });

  it('reports NOTHING_OWNED_FITS when no owned card matches', async () => {
    const { apis, context } = await setup();
    const ownership = { kind: 'session' as const, catalogEpoch: 'mock-1', ownedCardIds: [idOf('Farseek')] };
    const r = await apis.recs.swap({ context: context({ ownership }), targetCardId: idOf('Counterspell') });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.suggestions).toEqual([]);
    expect(r.data.emptyReason).toBe('NOTHING_OWNED_FITS');
  });
});

describe('mock cut and votes', () => {
  it('pins hard reasons to the top of the cut list', async () => {
    const { apis, context } = await setup();
    const r = await apis.recs.cut({ context: context({ includeGameChangers: false }) });
    if (!r.ok) throw new Error(r.error.message);
    const top = r.data.suggestions.slice(0, 3).map((s) => s.card.name).sort();
    expect(top).toEqual(['Cyclonic Rift', 'Lightning Bolt', 'Rhystic Study']);
  });

  it('records a vote and shifts the Bayesian score', async () => {
    const { apis } = await setup();
    const r = await apis.actions.castVote({ targetCardId: idOf('Swords to Plowshares'), replacementCardId: idOf('Path to Exile'), value: 1 });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.data.voteCount).toBe(1);
    expect(r.data.score).toBeGreaterThan(0.5);
    expect(r.data.myVote).toBe(1);
  });

  it('refuses Moxfield URLs until authorized', async () => {
    const { apis } = await setup();
    const r = await apis.actions.importDeckFromUrl({ url: 'https://moxfield.com/decks/abc123' });
    expect(r.ok ? null : r.error.code).toBe('UPSTREAM_NOT_AUTHORIZED');
  });
});
