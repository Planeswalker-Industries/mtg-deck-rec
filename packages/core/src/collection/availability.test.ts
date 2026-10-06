import { describe, expect, it } from 'vitest';
import type { CardId, DeckId } from '../contract';
import { availability, sessionCopies, type BuiltDeck } from './availability';

const SOL_RING = 1;
const EVOLVING_WILDS = 10;
const TERRAMORPHIC_EXPANSE = 11;
const PLAINS = 20;

const deck = (name: string, copies: [number, number][]): BuiltDeck => ({
  deck: { deckId: `00000000-0000-4000-8000-${name.padStart(12, '0')}` as DeckId, code: `code${name}`, name },
  copies: new Map(copies),
});

// Evolving Wilds and Terramorphic Expanse are rules-identical: one twin group, keyed by its base card.
const twins = new Map([
  [EVOLVING_WILDS, EVOLVING_WILDS],
  [TERRAMORPHIC_EXPANSE, EVOLVING_WILDS],
]);

describe('availability', () => {
  it('counts owned copies less the ones built decks hold', () => {
    const a = availability({ owned: new Map([[SOL_RING, 2]]), builtDecks: [deck('1', [[SOL_RING, 1]])] }, twins);
    expect(a.of(SOL_RING)).toEqual({ status: 'available', cardId: SOL_RING, owned: 2, free: 1 });
  });

  it('tags a card whose every copy is in built decks with those decks', () => {
    const first = deck('1', [[SOL_RING, 1]]);
    const second = deck('2', [[SOL_RING, 1]]);
    const a = availability({ owned: new Map([[SOL_RING, 2]]), builtDecks: [first, second, deck('3', [])] }, twins);
    expect(a.of(SOL_RING)).toEqual({ status: 'conflict', cardId: SOL_RING, owned: 2, decks: [first.deck, second.deck] });
  });

  it('lets an owned twin stand in for a card the player does not own', () => {
    const a = availability({ owned: new Map([[TERRAMORPHIC_EXPANSE, 1]]), builtDecks: [] }, twins);
    expect(a.of(EVOLVING_WILDS)).toEqual({ status: 'available', cardId: TERRAMORPHIC_EXPANSE, owned: 1, free: 1 });
    expect(a.poolIds()).toEqual([EVOLVING_WILDS, TERRAMORPHIC_EXPANSE]);
    expect(a.standInIds()).toEqual([TERRAMORPHIC_EXPANSE]);
  });

  it('prefers the card itself, then the twin with the most free copies', () => {
    const owned = new Map([
      [EVOLVING_WILDS, 1],
      [TERRAMORPHIC_EXPANSE, 3],
    ]);
    expect(availability({ owned, builtDecks: [] }, twins).of(EVOLVING_WILDS)).toMatchObject({ cardId: EVOLVING_WILDS });
    const held = availability({ owned, builtDecks: [deck('1', [[EVOLVING_WILDS, 1]])] }, twins);
    expect(held.of(EVOLVING_WILDS)).toMatchObject({ status: 'available', cardId: TERRAMORPHIC_EXPANSE, free: 3 });
  });

  it('calls a card unowned only when neither it nor a twin is owned', () => {
    const a = availability({ owned: new Map(), builtDecks: [deck('1', [[SOL_RING, 1]])] }, twins);
    expect(a.of(SOL_RING)).toEqual({ status: 'unowned' });
    expect(a.of(EVOLVING_WILDS)).toEqual({ status: 'unowned' });
  });

  it('always has basic lands', () => {
    const a = availability({ owned: new Map([[PLAINS, 4]]), builtDecks: [deck('1', [[PLAINS, 30]])] }, twins);
    expect(a.of(PLAINS, true)).toEqual({ status: 'basic', owned: 4 });
    expect(a.of(PLAINS + 1, true)).toEqual({ status: 'basic', owned: 0 });
  });

  it('never counts a built deck holding more copies than the collection records as negative', () => {
    const a = availability({ owned: new Map([[SOL_RING, 1]]), builtDecks: [deck('1', [[SOL_RING, 3]])] }, twins);
    expect(a.of(SOL_RING)).toMatchObject({ status: 'conflict', owned: 1 });
  });
});

describe('sessionCopies', () => {
  it('reads one copy each when the request sends no quantities', () => {
    const copies = sessionCopies({ kind: 'session', catalogEpoch: 'e', ownedCardIds: [1, 2] as CardId[] });
    expect([...(copies?.owned ?? [])]).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('reads the quantities aligned with the ids', () => {
    const copies = sessionCopies({ kind: 'session', catalogEpoch: 'e', ownedCardIds: [1, 2] as CardId[], quantities: [3, 1] });
    expect(copies?.owned.get(1)).toBe(3);
  });

  it('has nothing to read for an account or no collection', () => {
    expect(sessionCopies({ kind: 'account' })).toBeNull();
    expect(sessionCopies(null)).toBeNull();
  });
});
