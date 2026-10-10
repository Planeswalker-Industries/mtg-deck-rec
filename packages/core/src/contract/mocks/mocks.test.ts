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

describe('mock commander deck lookups', () => {
  it('starts one lookup per commander, shares it, and reports it as coverage', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const commanderId = idOf('Chulane, Teller of Tales');
    const before = await apis.actions.getCommanderCoverage({ commanderId });
    expect(before.ok && before.data.request).toBeNull();

    const started = await apis.actions.requestCommanderDecks({ commanderId });
    const joined = await apis.actions.requestCommanderDecks({ commanderId });
    if (!started.ok || !joined.ok) throw new Error('lookup request failed');
    expect(started.data.status).toBe('checking');
    expect(joined.data.id).toBe(started.data.id);

    const coverage = await apis.actions.getCommanderCoverage({ commanderId });
    expect(coverage.ok && coverage.data.request?.id).toBe(started.data.id);
    const progress = await apis.actions.getCommanderRequest({ requestId: started.data.id });
    expect(progress.ok && progress.data.commander.id).toBe(commanderId);
    const missing = await apis.actions.getCommanderRequest({ requestId: '999' });
    expect(!missing.ok && missing.error.code).toBe('NOT_FOUND');
  });
});

describe('mock deck coverage', () => {
  it('allocates browser quantities once, counts only main cards and commanders, and returns target metadata', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const commander = idOf('Chulane, Teller of Tales');
    const ring = idOf('Sol Ring');
    const deck = {
      commanders: [commander],
      cards: [
        { cardId: commander, quantity: 1, section: 'commander' as const },
        { cardId: ring, quantity: 2, section: 'main' as const },
        { cardId: ring, quantity: 1, section: 'main' as const },
        { cardId: ring, quantity: 4, section: 'sideboard' as const },
      ],
    };
    const result = await apis.actions.getDeckCoverage({
      deck,
      ownership: { kind: 'session', catalogEpoch: 'mock-1', ownedCardIds: [ring, commander], quantities: [2, 1] },
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.data.coverage).toMatchObject({ total: 4, owned: 3, standIn: 0, conflict: 0, missing: 1 });
    expect(result.data.coverage.cards.find((card) => card.cardId === ring)?.allocations).toEqual([
      { status: 'owned', quantity: 2 }, { status: 'missing', quantity: 1 },
    ]);
    expect(result.data.cards.map((card) => card.id)).toEqual([commander, ring].sort((a, b) => a - b));
  });

  it('reads editable account quantities and excludes the current built deck from conflicts', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const ring = idOf('Sol Ring');
    const deckId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' as import('../ids').DeckId;
    const deck = { commanders: [], cards: [{ cardId: ring, quantity: 2, section: 'main' as const }] };
    await apis.actions.setCollectionCardQuantity({ cardId: ring, quantity: 2 });
    const entries = await apis.actions.getMyCollectionEntries();
    expect(entries.ok && entries.data.find((entry) => entry.cardId === ring)?.quantity).toBe(2);
    await apis.actions.saveDeck({ deckId, name: 'Held deck', deck: { ...deck, cards: [{ cardId: ring, quantity: 1, section: 'main' }] }, isPublic: false });
    await apis.actions.setDeckBuilt({ deckId, isBuilt: true });

    const held = await apis.actions.getDeckCoverage({ deck, ownership: { kind: 'account' } });
    if (!held.ok) throw new Error(held.error.message);
    expect(held.data.coverage).toMatchObject({ total: 2, owned: 1, conflict: 1, missing: 0 });
    expect(held.data.coverage.cards[0]?.allocations).toEqual([
      { status: 'owned', quantity: 1 },
      { status: 'conflict', quantity: 1, sourceCardId: ring, decks: [{ deckId, code: expect.any(String), name: 'Held deck' }] },
    ]);
    const current = await apis.actions.getDeckCoverage({ deck, ownership: { kind: 'account', deckId } });
    expect(current.ok && current.data.coverage).toMatchObject({ owned: 2, conflict: 0, missing: 0 });
    await apis.actions.setCollectionCardQuantity({ cardId: ring, quantity: 1 });
    const changed = await apis.actions.getDeckCoverage({ deck, ownership: { kind: 'account', deckId } });
    expect(changed.ok && changed.data.coverage).toMatchObject({ owned: 1, missing: 1 });
  });

  it('counts a built commander once when also listed in its commander section', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const commander = idOf('Chulane, Teller of Tales');
    const deckId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' as import('../ids').DeckId;
    const deck = { commanders: [commander], cards: [{ cardId: commander, quantity: 1, section: 'commander' as const }] };
    await apis.actions.setCollectionCardQuantity({ cardId: commander, quantity: 2 });
    await apis.actions.saveDeck({ deckId, name: 'Built commander', deck, isPublic: false });
    await apis.actions.setDeckBuilt({ deckId, isBuilt: true });

    const coverage = await apis.actions.getDeckCoverage({ deck, ownership: { kind: 'account' } });
    if (!coverage.ok) throw new Error(coverage.error.message);
    expect(coverage.data.coverage).toMatchObject({ total: 1, owned: 1, conflict: 0, missing: 0 });
    expect(coverage.data.coverage.cards[0]?.allocations).toEqual([{ status: 'owned', quantity: 1 }]);
  });

  it('returns validation or not-found Results', async () => {
    const apis = createMockApis({ latencyMs: 0 });
    const deck = { commanders: [], cards: [{ cardId: idOf('Sol Ring'), quantity: 1, section: 'main' as const }] };
    const ownership = { kind: 'session' as const, catalogEpoch: 'mock-1', ownedCardIds: [] };
    const invalid = await apis.actions.getDeckCoverage({ deck, ownership: undefined } as unknown as Parameters<typeof apis.actions.getDeckCoverage>[0]);
    expect(!invalid.ok && invalid.error.code).toBe('VALIDATION');
    const badCard = await apis.actions.getDeckCoverage({ deck: { ...deck, cards: [{ cardId: 0 as CardId, quantity: 1, section: 'main' }] }, ownership });
    expect(!badCard.ok && badCard.error.code).toBe('VALIDATION');
    // Outside the fixture catalog; the read must not silently drop an unknown target.
    const UNKNOWN_FIXTURE_CARD_ID = 999999 as CardId;
    const unknown = await apis.actions.getDeckCoverage({ deck: { ...deck, cards: [{ cardId: UNKNOWN_FIXTURE_CARD_ID, quantity: 1, section: 'main' }] }, ownership });
    expect(!unknown.ok && unknown.error.code).toBe('NOT_FOUND');
  });
});

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

describe('mock collection modes', () => {
  it("'only' keeps adds to owned cards; 'first' suggests everything, owned cards ranked up", async () => {
    const { apis, context } = await setup();
    const ownership = { kind: 'account' as const };
    const flat = (r: Awaited<ReturnType<typeof apis.recs.add>>) => (r.ok ? r.data.groups.flatMap((g) => g.suggestions) : []);

    const only = flat(await apis.recs.add({ context: context({ ownership }) }));
    expect(only.every((s) => s.owned !== null)).toBe(true);

    const first = await apis.recs.add({ context: context({ ownership, ownershipMode: 'first' }) });
    const all = flat(first);
    expect(all.some((s) => s.owned === null)).toBe(true);
    expect(all.some((s) => s.owned !== null)).toBe(true);

    // Within each group an owned card never sits below an unowned one that scores less than the boost above it.
    const groups = first.ok ? first.data.groups : [];
    for (const { suggestions } of groups) {
      for (let i = 1; i < suggestions.length; i++) {
        const [above, below] = [suggestions[i - 1]!, suggestions[i]!];
        if (below.owned && !above.owned) expect(above.score.total - below.score.total).toBeGreaterThanOrEqual(0.1);
      }
    }
  });

  it("'first' never flags cuts as not owned", async () => {
    const { apis, context } = await setup();
    const cut = await apis.recs.cut({ context: context({ ownership: { kind: 'account' }, ownershipMode: 'first' }) });
    expect(cut.ok && cut.data.suggestions.every((s) => !s.reasons.includes('NOT_OWNED'))).toBe(true);
  });
});

describe('mock add exclusions', () => {
  it('leaves out cards the player passed on, and offers the next ones instead', async () => {
    const { apis, context } = await setup();
    const ids = (r: Awaited<ReturnType<typeof apis.recs.add>>) => (r.ok ? r.data.groups.flatMap((g) => g.suggestions.map((s) => s.card.id)) : []);
    const before = ids(await apis.recs.add({ context: context() }));
    expect(before.length).toBeGreaterThan(0);
    const passed = before.slice(0, 2);
    const after = ids(await apis.recs.add({ context: context(), excludeCardIds: passed }));
    expect(after.some((id) => passed.includes(id))).toBe(false);
  });
});

describe('mock build', () => {
  it('builds from owned cards, accounts for every slot, and fills by value on request', async () => {
    const { apis, context } = await setup();
    const ownership = { kind: 'account' as const };
    const base = context({ ownership });
    const commanderOnly = { ...base, deck: { ...base.deck, cards: [] } };
    const owned = await apis.recs.build({ context: commanderOnly });
    expect(owned.ok).toBe(true);
    if (!owned.ok) return;
    const f = owned.data.feasibility;
    expect(f.filled + f.filledByValue + f.open).toBe(f.slots);
    expect(owned.data.groups.flatMap((g) => g.cards).every((c) => c.owned !== null && c.origin === 'pick')).toBe(true);

    const filled = await apis.recs.build({ context: commanderOnly, fill: 'value' });
    expect(filled.ok && filled.data.fillCost !== undefined && filled.data.feasibility.filledByValue > 0).toBe(true);
  });
});
