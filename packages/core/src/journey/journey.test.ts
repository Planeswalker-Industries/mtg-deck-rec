import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, DeckInput, IsoDateTime } from '../contract';
import { deckStats } from './deck-stats';
import { decklistFor, deckDiff, deckSize, journeyReducer, openSlots, startJourney, workingDeck, type JourneyAction, type JourneyState } from './journey';

const card = (id: number, overrides: Partial<CardSummary> = {}): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as CardSummary['oracleId'],
  name: `Card ${id}`,
  slug: `card-${id}`,
  manaValue: 2,
  typeLine: 'Creature — Bear',
  colorIdentity: 'G',
  images: null,
  gameChanger: false,
  released: true,
  price: null,
  keywords: [],
  ...overrides,
});

const COMMANDER = 1 as CardId;
const PLAINS = 50 as CardId;

/** A full deck: a commander, three singletons and 96 Plains. */
const FULL_PLAINS = 96;
const base: DeckInput = {
  commanders: [COMMANDER],
  cards: [
    { cardId: COMMANDER, quantity: 1, section: 'commander' },
    { cardId: 2 as CardId, quantity: 1, section: 'main' },
    { cardId: 3 as CardId, quantity: 1, section: 'main' },
    { cardId: 4 as CardId, quantity: 1, section: 'main' },
    { cardId: PLAINS, quantity: FULL_PLAINS, section: 'main' },
  ],
};

const run = (...actions: JourneyAction[]): JourneyState => actions.reduce(journeyReducer, startJourney(base));
const mainOf = (deck: DeckInput) =>
  Object.fromEntries(deck.cards.filter((c) => c.section === 'main').map((c) => [c.cardId, c.quantity]));

describe('journey reducer', () => {
  it('starts in the Cut phase with nothing changed', () => {
    const state = startJourney(base);
    expect(state.phase).toBe('cut');
    expect(workingDeck(state)).toEqual({ commanders: [COMMANDER], cards: base.cards });
  });

  it('opens a slot per cut in a full deck and never cuts more copies than the deck has', () => {
    const state = run(
      { type: 'cut', card: card(2) },
      { type: 'cut', card: card(2) },
      { type: 'cut', card: card(PLAINS) },
      { type: 'cut', card: card(PLAINS) },
    );
    expect(state.cuts.map((c) => c.id)).toEqual([2, PLAINS, PLAINS]);
    expect(openSlots(state)).toBe(3);
    expect(mainOf(workingDeck(state))).toEqual({ 3: 1, 4: 1, [PLAINS]: FULL_PLAINS - 2 });
    const single = { cardId: 1 as CardId, quantity: 1, section: 'main' as const };
    const cuts = [0, 1, 2, 3].map((): JourneyAction => ({ type: 'cut', card: card(1) }));
    expect(cuts.reduce(journeyReducer, startJourney({ commanders: [], cards: [single] })).cuts).toHaveLength(1);
  });

  it('counts slots from the deck size: an oversized deck gets none until it is down to 100, a short one has room already', () => {
    const over: DeckInput = { ...base, cards: [...base.cards, { cardId: 5 as CardId, quantity: 1, section: 'main' }] };
    const cutOne = [{ type: 'cut', card: card(5) } as const].reduce(journeyReducer, startJourney(over));
    expect(openSlots(startJourney(over))).toBe(0);
    expect(openSlots(cutOne)).toBe(0);
    const short: DeckInput = { ...base, cards: base.cards.filter((c) => c.cardId !== 4) };
    expect(openSlots(startJourney(short))).toBe(1);
  });

  it('keeping a card takes it out of the cuts and remembers the choice', () => {
    const state = run({ type: 'cut', card: card(2) }, { type: 'keep', cardId: 2 as CardId });
    expect(state.cuts).toEqual([]);
    expect(state.kept).toEqual([2]);
    expect(run({ type: 'keep', cardId: 2 as CardId }, { type: 'cut', card: card(2) }).kept).toEqual([]);
  });

  it('adds only into open slots, once per card', () => {
    const state = run(
      { type: 'cut', card: card(2) },
      { type: 'add', card: card(10) },
      { type: 'add', card: card(11) },
    );
    expect(state.adds.map((c) => c.id)).toEqual([10]);
    expect(openSlots(state)).toBe(0);
    expect(mainOf(workingDeck(state))).toEqual({ 3: 1, 4: 1, 10: 1, [PLAINS]: FULL_PLAINS });
  });

  it('a declined addition stays declined until it is added after all', () => {
    const declined = run({ type: 'cut', card: card(2) }, { type: 'declineAdd', cardId: 10 as CardId });
    expect(declined.declinedAdds).toEqual([10]);
    expect(journeyReducer(declined, { type: 'add', card: card(10) }).declinedAdds).toEqual([]);
  });

  it('swaps replace one copy, including a card added this round, and undoing an addition drops its swap', () => {
    const state = run(
      { type: 'cut', card: card(2) },
      { type: 'add', card: card(10) },
      { type: 'swap', target: card(3), replacement: card(20) },
      { type: 'swap', target: card(10), replacement: card(21) },
      { type: 'swap', target: card(PLAINS), replacement: card(22) },
    );
    expect(mainOf(workingDeck(state))).toEqual({ 4: 1, 20: 1, 21: 1, 22: 1, [PLAINS]: FULL_PLAINS - 1 });
    const undone = journeyReducer(state, { type: 'unadd', cardId: 10 as CardId });
    expect(undone.swaps.map((s) => s.target.id)).toEqual([3, PLAINS]);
  });

  it('a second swap for the same card replaces the first, and keeping the card clears it', () => {
    const state = run({ type: 'swap', target: card(3), replacement: card(20) }, { type: 'swap', target: card(3), replacement: card(21) });
    expect(state.swaps.map((s) => s.replacement.id)).toEqual([21]);
    const kept = journeyReducer(state, { type: 'keepInReplace', cardId: 3 as CardId });
    expect(kept.swaps).toEqual([]);
    expect(kept.keptInReplace).toEqual([3]);
  });

  it('moves between phases and resets to a new round', () => {
    const state = run({ type: 'cut', card: card(2) }, { type: 'goto', phase: 'review' });
    expect(state.phase).toBe('review');
    const next = journeyReducer(state, { type: 'reset', base: workingDeck(state) });
    expect(next).toEqual(startJourney(workingDeck(state)));
  });
});

describe('deck helpers', () => {
  it('diffs the main deck by net copies', () => {
    const state = run(
      { type: 'cut', card: card(2) },
      { type: 'cut', card: card(PLAINS) },
      { type: 'add', card: card(10) },
      { type: 'swap', target: card(3), replacement: card(20) },
    );
    const diff = deckDiff(base, workingDeck(state));
    expect(diff.removed).toEqual(expect.arrayContaining([{ cardId: 2, quantity: 1 }, { cardId: PLAINS, quantity: 1 }, { cardId: 3, quantity: 1 }]));
    expect(diff.added).toEqual(expect.arrayContaining([{ cardId: 10, quantity: 1 }, { cardId: 20, quantity: 1 }]));
    expect(deckSize(base)).toBe(100);
    expect(deckSize(workingDeck(state))).toBe(99);
  });

  it('writes a decklist the parser reads back, leaving out unknown cards', () => {
    const names: Record<number, string> = { [COMMANDER]: 'Liesa', 2: 'Bear', 3: 'Arcane Signet', [PLAINS]: 'Plains' };
    const text = decklistFor(base, (id) => names[id] ?? null);
    expect(text).toBe(`Commander\n1 Liesa\n\nDeck\n1 Arcane Signet\n1 Bear\n${FULL_PLAINS} Plains\n`);
  });
});

describe('deckStats', () => {
  it('counts the curve without lands, caps the top bar, and totals known prices', () => {
    const asOf = '2026-09-20T00:00:00+00:00' as IsoDateTime;
    const price = (usd: number) => ({ usd, finish: 'nonfoil' as const, asOf, source: 'scryfall' as const });
    const stats = deckStats([
      { card: card(1, { manaValue: 1, price: price(2) }), quantity: 1 },
      { card: card(2, { manaValue: 9, gameChanger: true, price: price(10) }), quantity: 1 },
      { card: card(3, { manaValue: 0, typeLine: 'Basic Land — Plains' }), quantity: 4 },
    ]);
    expect(stats).toMatchObject({ cards: 6, lands: 4, averageManaValue: 5, gameChangers: 1, priceUsd: 12, unpriced: 4, priceAsOf: asOf });
    expect(stats.curve[1]).toBe(1);
    expect(stats.curve.at(-1)).toBe(1);
    expect(stats.curve.reduce((a, b) => a + b, 0)).toBe(2);
    expect(stats.types).toEqual([
      { label: 'Creature', count: 2 },
      { label: 'Land', count: 4 },
    ]);
  });
});
