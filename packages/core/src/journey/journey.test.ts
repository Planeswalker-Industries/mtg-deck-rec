import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, DeckInput, IsoDateTime } from '../contract';
import { deckStats } from './deck-stats';
import {
  copiesInDeck,
  deckBeforeFixes,
  deckBeforeSwaps,
  deckKey,
  decklistFor,
  deckDiff,
  deckSize,
  cutsNeeded,
  journeyReducer,
  nextPhase,
  openSlots,
  phasesFor,
  pushUndo,
  roundAddedIds,
  roundPhases,
  UNDO_DEPTH,
  startJourney,
  workingDeck,
  type JourneyAction,
  type JourneyState,
} from './journey';

const card = (id: number, overrides: Partial<CardSummary> = {}): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as CardSummary['oracleId'],
  name: `Card ${id}`,
  slug: `card-${id}`,
  manaCost: '',
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

/** The same deck a card short of 100, and a card over it. */
const short: DeckInput = { ...base, cards: base.cards.filter((c) => c.cardId !== 4) };
const over: DeckInput = { ...base, cards: [...base.cards, { cardId: 5 as CardId, quantity: 1, section: 'main' }] };

const run = (...actions: JourneyAction[]): JourneyState => actions.reduce(journeyReducer, startJourney(base));
const mainOf = (deck: DeckInput) =>
  Object.fromEntries(deck.cards.filter((c) => c.section === 'main').map((c) => [c.cardId, c.quantity]));

describe('journey reducer', () => {
  it('starts on the first step its deck needs, with nothing changed', () => {
    const state = startJourney(base);
    expect(state.phase).toBe('fix');
    expect(workingDeck(state)).toEqual({ commanders: [COMMANDER], cards: base.cards });
    expect(startJourney(short).phase).toBe('add');
    expect(startJourney(over).phase).toBe('cut');
  });

  it('runs Add only under 100 cards, Cut only over 100, and keeps the steps for the round', () => {
    expect(phasesFor(99)).toEqual(['add', 'fix', 'replace', 'review']);
    expect(phasesFor(100)).toEqual(['fix', 'replace', 'review']);
    expect(phasesFor(101)).toEqual(['cut', 'fix', 'replace', 'review']);
    // The round's steps follow the deck it started from, not the deck as it stands.
    const filled = journeyReducer(startJourney(short), { type: 'add', card: card(10) });
    expect(deckSize(workingDeck(filled))).toBe(100);
    expect(roundPhases(filled)).toEqual(['add', 'fix', 'replace', 'review']);
    expect(nextPhase(filled)).toBe('fix');
    expect(nextPhase(filled, 'review')).toBeNull();
    expect(nextPhase(startJourney(base), 'add')).toBeNull();
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
    const cutOne = [{ type: 'cut', card: card(5) } as const].reduce(journeyReducer, startJourney(over));
    expect(openSlots(startJourney(over))).toBe(0);
    expect(openSlots(cutOne)).toBe(0);
    expect(openSlots(startJourney(short))).toBe(1);
  });

  it('keeping a card takes it out of the cuts and remembers the choice', () => {
    const state = run({ type: 'cut', card: card(2) }, { type: 'keep', cardId: 2 as CardId });
    expect(state.cuts).toEqual([]);
    expect(state.kept).toEqual([2]);
    expect(run({ type: 'keep', cardId: 2 as CardId }, { type: 'cut', card: card(2) }).kept).toEqual([]);
  });

  it('adds once per card and stops at 100', () => {
    const open = run({ type: 'cut', card: card(2) }, { type: 'cut', card: card(3) });
    const state = [card(10), card(10), card(11), card(12)].map((c): JourneyAction => ({ type: 'add', card: c })).reduce(journeyReducer, open);
    expect(state.adds.map((c) => c.id)).toEqual([10, 11]);
    expect(openSlots(state)).toBe(0);
    expect(cutsNeeded(state)).toBe(0);
    expect(mainOf(workingDeck(state))).toEqual({ 4: 1, 10: 1, 11: 1, [PLAINS]: FULL_PLAINS });
    // A full deck takes no addition at all.
    expect(run({ type: 'add', card: card(10) }).adds).toEqual([]);
  });

  it('owes a cut per card over 100, and none at or below a full deck', () => {
    expect(cutsNeeded(startJourney(over))).toBe(1);
    expect(cutsNeeded(startJourney(base))).toBe(0);
    expect(cutsNeeded(run({ type: 'cut', card: card(2) }))).toBe(0);
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

  it('adds a basic land more than once, and taking one back out takes one copy', () => {
    const forest = card(60, { typeLine: 'Basic Land — Forest' });
    const state = run({ type: 'cut', card: card(2) }, { type: 'cut', card: card(3) }, { type: 'add', card: forest }, { type: 'add', card: forest });
    expect(mainOf(workingDeck(state))).toEqual({ 4: 1, 60: 2, [PLAINS]: FULL_PLAINS });
    const undone = journeyReducer(state, { type: 'unadd', cardId: 60 as CardId });
    expect(undone.adds.map((c) => c.id)).toEqual([60]);
    expect(journeyReducer(undone, { type: 'unadd', cardId: 61 as CardId })).toBe(undone);
  });

  it('a second swap for the same card replaces the first, and keeping the card clears it', () => {
    const state = run({ type: 'swap', target: card(3), replacement: card(20) }, { type: 'swap', target: card(3), replacement: card(21) });
    expect(state.swaps.map((s) => s.replacement.id)).toEqual([21]);
    const kept = journeyReducer(state, { type: 'keepInReplace', cardId: 3 as CardId });
    expect(kept.swaps).toEqual([]);
    expect(kept.keptInReplace).toEqual([3]);
  });

  it('ignores a swap for a card no longer in the deck', () => {
    const state = run({ type: 'cut', card: card(3) }, { type: 'swap', target: card(3), replacement: card(20) });
    expect(state.swaps).toEqual([]);
  });

  it('undoing a swap also drops a later swap of the card it brought in', () => {
    const state = run({ type: 'swap', target: card(3), replacement: card(20) }, { type: 'swap', target: card(20), replacement: card(21) });
    expect(mainOf(workingDeck(state))[21]).toBe(1);
    const undone = journeyReducer(state, { type: 'unswap', targetId: 3 as CardId });
    expect(undone.swaps).toEqual([]);
    expect(mainOf(workingDeck(undone))).toEqual({ 2: 1, 3: 1, 4: 1, [PLAINS]: FULL_PLAINS });
  });

  it('remembers each declined replacement once', () => {
    const decline: JourneyAction = { type: 'declineSwap', targetId: 3 as CardId, replacementId: 20 as CardId };
    expect(run(decline, decline).declinedSwaps).toEqual([{ targetId: 3, replacementId: 20 }]);
  });

  it('moves between phases and resets to a new round', () => {
    const state = run({ type: 'cut', card: card(2) }, { type: 'goto', phase: 'review' });
    expect(state.phase).toBe('review');
    const next = journeyReducer(state, { type: 'reset', base: workingDeck(state) });
    expect(next).toEqual(startJourney(workingDeck(state)));
  });

  it('remembers the furthest phase opened when going back', () => {
    const state = run({ type: 'goto', phase: 'review' }, { type: 'goto', phase: 'fix' }, { type: 'goto', phase: 'replace' });
    expect(state.phase).toBe('replace');
    expect(state.reached).toBe('review');
    expect(startJourney(base).reached).toBe('fix');
  });
});

describe('Fix moves', () => {
  const move = (inId: number, outId: number, line = 'ramp') => ({ type: 'fix' as const, move: { line, in: card(inId), out: card(outId) } });

  it('trades one card for one, so the deck keeps its size, and a batch undoes as one choice', () => {
    const state = run(move(10, 2), move(11, 3));
    expect(mainOf(workingDeck(state))).toEqual({ 4: 1, 10: 1, 11: 1, [PLAINS]: FULL_PLAINS });
    expect(deckSize(workingDeck(state))).toBe(100);
    expect(mainOf(deckBeforeFixes(state))).toEqual(mainOf(base));
    const start = startJourney(base);
    expect(pushUndo([], start, state, [move(10, 2), move(11, 3)])).toEqual([start]);
  });

  it('ignores a move whose out card is gone or whose in card is already in the deck', () => {
    const once = run(move(10, 2));
    expect(journeyReducer(once, move(11, 2))).toBe(once);
    expect(journeyReducer(once, move(10, 3))).toBe(once);
    expect(journeyReducer(once, { type: 'cut', card: card(2) })).toBe(once);
  });

  it('takes out one copy of a basic land per move, and brings one in more than once', () => {
    const forest = card(60, { typeLine: 'Basic Land — Forest' });
    const plains = card(PLAINS, { typeLine: 'Basic Land — Plains' });
    const state = run({ type: 'fix', move: { line: 'sources:G', in: forest, out: plains } }, { type: 'fix', move: { line: 'sources:G', in: forest, out: plains } });
    expect(mainOf(workingDeck(state))).toEqual({ 2: 1, 3: 1, 4: 1, 60: 2, [PLAINS]: FULL_PLAINS - 2 });
    expect(copiesInDeck(state, 60 as CardId)).toBe(2);
  });

  it('keeps the cards the round brought in from going out again, basic lands apart', () => {
    const forest = card(60, { typeLine: 'Basic Land — Forest' });
    const state = [
      { type: 'add', card: card(10) } as const,
      move(11, 2),
      { type: 'fix', move: { line: 'lands', in: forest, out: card(PLAINS) } } as const,
      { type: 'swap', target: card(3), replacement: card(20) } as const,
    ].reduce(journeyReducer, startJourney(short));
    expect(roundAddedIds(state).sort((a, b) => a - b)).toEqual([10, 11, 20]);
  });

  it('remembers each skipped pair once, and forgets them all on a retry', () => {
    const skip: JourneyAction = { type: 'declineFix', inId: 10 as CardId, outId: 2 as CardId };
    const skipped = run(skip, skip);
    expect(skipped.declinedFixes).toEqual([{ inId: 10, outId: 2 }]);
    expect(journeyReducer(skipped, { type: 'retryFixes' }).declinedFixes).toEqual([]);
    const start = startJourney(base);
    expect(journeyReducer(start, { type: 'retryFixes' })).toBe(start);
  });
});

describe('undo stack', () => {
  const start = startJourney(base);

  it('records a choice and steps back to the state before it, but not a move between steps', () => {
    const cut: JourneyAction = { type: 'cut', card: card(2) };
    const after = journeyReducer(start, cut);
    expect(pushUndo([], start, after, [cut])).toEqual([start]);
    const moved = journeyReducer(after, { type: 'goto', phase: 'cut' });
    expect(pushUndo([start], after, moved, [{ type: 'goto', phase: 'cut' }])).toEqual([start]);
  });

  it('records nothing when the choice changed nothing', () => {
    const twice: JourneyAction = { type: 'declineSwap', targetId: 3 as CardId, replacementId: 20 as CardId };
    const once = journeyReducer(start, twice);
    expect(pushUndo([start], once, journeyReducer(once, twice), [twice])).toEqual([start]);
  });

  it('records a start over, so it can be undone too', () => {
    const changed = run({ type: 'cut', card: card(2) });
    const reset: JourneyAction = { type: 'reset', base };
    expect(pushUndo([], changed, journeyReducer(changed, reset), [reset])).toEqual([changed]);
  });

  it('keeps at most UNDO_DEPTH states, dropping the oldest', () => {
    const past = Array.from({ length: UNDO_DEPTH }, () => start);
    const after = journeyReducer(start, { type: 'cut', card: card(2) });
    const next = pushUndo(past, after, journeyReducer(after, { type: 'cut', card: card(3) }), [{ type: 'cut', card: card(3) }]);
    expect(next).toHaveLength(UNDO_DEPTH);
    expect(next.at(-1)).toBe(after);
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
    expect(copiesInDeck(state, 20 as CardId)).toBe(1);
    const diff = deckDiff(base, workingDeck(state));
    expect(diff.removed).toEqual(expect.arrayContaining([{ cardId: 2, quantity: 1 }, { cardId: PLAINS, quantity: 1 }, { cardId: 3, quantity: 1 }]));
    expect(diff.added).toEqual(expect.arrayContaining([{ cardId: 10, quantity: 1 }, { cardId: 20, quantity: 1 }]));
    expect(deckSize(base)).toBe(100);
    expect(deckSize(workingDeck(state))).toBe(99);
  });

  it('keeps swapped cards in the deck before swaps, which does not move as swaps are picked', () => {
    const cut = run({ type: 'cut', card: card(2) }, { type: 'add', card: card(10) });
    const swapped = journeyReducer(cut, { type: 'swap', target: card(3), replacement: card(20) });
    expect(mainOf(deckBeforeSwaps(swapped))).toEqual({ 3: 1, 4: 1, 10: 1, [PLAINS]: FULL_PLAINS });
    expect(deckKey(deckBeforeSwaps(swapped))).toBe(deckKey(deckBeforeSwaps(cut)));
    expect(deckKey(workingDeck(swapped))).not.toBe(deckKey(workingDeck(cut)));
  });

  it('keys a deck by its contents, not their order', () => {
    const reordered: DeckInput = { commanders: base.commanders, cards: [...base.cards].reverse() };
    expect(deckKey(reordered)).toBe(deckKey(base));
    expect(deckKey(workingDeck(run({ type: 'cut', card: card(2) })))).not.toBe(deckKey(base));
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


