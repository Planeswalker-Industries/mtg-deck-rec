import { describe, expect, it } from 'vitest';
import type { CardId, DeckId, DeckInput } from '../contract';
import type { CollectionCopies, BuiltDeck } from './availability';
import { deckCoverage } from './coverage';

const TARGET = 10 as CardId;
const TWIN = 11 as CardId;
const OTHER_TWIN = 12 as CardId;
const BASIC = 20 as CardId;
const COMMANDER = 30 as CardId;
const unrelated = 40 as CardId;
const twins = new Map<number, number>([[TARGET, TARGET], [TWIN, TARGET], [OTHER_TWIN, TARGET]]);
const basics = new Set<number>([BASIC]);
const input = (commanders: CardId[], cards: DeckInput['cards']): DeckInput => ({ commanders, cards });
const main = (cardId: CardId, quantity: number): DeckInput['cards'][number] => ({ cardId, quantity, section: 'main' });
const collection = (owned: [CardId, number][], builtDecks: BuiltDeck[] = []): CollectionCopies => ({ owned: new Map(owned), builtDecks });
const built = (number: string, copies: [CardId, number][]): BuiltDeck => ({
  deck: { deckId: `00000000-0000-4000-8000-${number.padStart(12, '0')}` as DeckId, code: `code${number}`, name: number },
  copies: new Map(copies),
});

describe('deckCoverage', () => {
  it('folds repeated main entries, includes each commander once, excludes other sections and assumes basics without inventory', () => {
    const deck = input([COMMANDER, COMMANDER], [
      main(TARGET, 2), main(TARGET, 3), main(BASIC, 4),
      { cardId: COMMANDER, quantity: 1, section: 'commander' },
      { cardId: unrelated, quantity: 3, section: 'sideboard' },
      { cardId: unrelated, quantity: 2, section: 'maybeboard' },
      { cardId: unrelated, quantity: 1, section: 'companion' },
    ]);
    const result = deckCoverage(deck, collection([[TARGET, 2], [COMMANDER, 1]]), twins, basics);
    expect(result).toEqual({
      total: 10, owned: 3, standIn: 0, basic: 4, conflict: 0, missing: 3,
      cards: [
        { cardId: TARGET, quantity: 5, allocations: [{ status: 'owned', quantity: 2 }, { status: 'missing', quantity: 3 }] },
        { cardId: BASIC, quantity: 4, allocations: [{ status: 'basic', quantity: 4 }] },
        { cardId: COMMANDER, quantity: 1, allocations: [{ status: 'owned', quantity: 1 }] },
      ],
    });
  });

  it('reports all five states on one target, caps held by owned, and sorts the holding decks', () => {
    const later = built('2', [[TARGET, 2]]);
    const earlier = built('1', [[TARGET, 1]]);
    const result = deckCoverage(input([], [main(TARGET, 6), main(BASIC, 1)]),
      collection([[TARGET, 2], [TWIN, 1]], [later, earlier]), twins, basics);
    expect(result.cards[0]?.allocations).toEqual([
      { status: 'stand-in', quantity: 1, sourceCardId: TWIN },
      { status: 'conflict', quantity: 2, sourceCardId: TARGET, decks: [earlier.deck, later.deck] },
      { status: 'missing', quantity: 3 },
    ]);
    expect(result).toMatchObject({ total: 7, owned: 0, standIn: 1, basic: 1, conflict: 2, missing: 3 });
  });

  it('splits one target across exact free, twin free, exact held, twin held and missing', () => {
    const holder = built('1', [[TARGET, 1], [TWIN, 1]]);
    const result = deckCoverage(input([], [main(TARGET, 6)]), collection([[TARGET, 2], [TWIN, 2]], [holder]), twins, basics);
    expect(result.cards[0]?.allocations).toEqual([
      { status: 'owned', quantity: 1 },
      { status: 'stand-in', quantity: 1, sourceCardId: TWIN },
      { status: 'conflict', quantity: 1, sourceCardId: TARGET, decks: [holder.deck] },
      { status: 'conflict', quantity: 1, sourceCardId: TWIN, decks: [holder.deck] },
      { status: 'missing', quantity: 2 },
    ]);
  });

  it('reserves all exact free copies before spending twins, including when the lower target id goes first', () => {
    const result = deckCoverage(input([], [main(TARGET, 2), main(TWIN, 1)]), collection([[TWIN, 2]]), twins, basics);
    expect(result.cards).toEqual([
      { cardId: TARGET, quantity: 2, allocations: [{ status: 'stand-in', quantity: 1, sourceCardId: TWIN }, { status: 'missing', quantity: 1 }] },
      { cardId: TWIN, quantity: 1, allocations: [{ status: 'owned', quantity: 1 }] },
    ]);
  });

  it('uses every exact held allocation before any held twin, even when lower target id competes for it', () => {
    const holder = built('1', [[TWIN, 1]]);
    const result = deckCoverage(input([], [main(TARGET, 1), main(TWIN, 1)]), collection([[TWIN, 1]], [holder]), twins, basics);
    expect(result.cards).toEqual([
      { cardId: TARGET, quantity: 1, allocations: [{ status: 'missing', quantity: 1 }] },
      { cardId: TWIN, quantity: 1, allocations: [{ status: 'conflict', quantity: 1, sourceCardId: TWIN, decks: [holder.deck] }] },
    ]);
  });

  it('gives one contested free twin to one target only, with sorted target order', () => {
    const result = deckCoverage(input([], [main(TWIN, 1), main(TARGET, 1)]), collection([[OTHER_TWIN, 1]]), twins, basics);
    expect(result.cards).toEqual([
      { cardId: TARGET, quantity: 1, allocations: [{ status: 'stand-in', quantity: 1, sourceCardId: OTHER_TWIN }] },
      { cardId: TWIN, quantity: 1, allocations: [{ status: 'missing', quantity: 1 }] },
    ]);
  });

  it('chooses twins by most remaining supply then lowest id, recalculating after consumption', () => {
    const result = deckCoverage(input([], [main(TARGET, 5)]), collection([[TWIN, 2], [OTHER_TWIN, 3]]), twins, basics);
    expect(result.cards[0]?.allocations).toEqual([
      { status: 'stand-in', quantity: 3, sourceCardId: OTHER_TWIN },
      { status: 'stand-in', quantity: 2, sourceCardId: TWIN },
    ]);
    const tied = deckCoverage(input([], [main(TARGET, 2)]), collection([[OTHER_TWIN, 1], [TWIN, 1]]), twins, basics);
    expect(tied.cards[0]?.allocations).toEqual([
      { status: 'stand-in', quantity: 1, sourceCardId: TWIN },
      { status: 'stand-in', quantity: 1, sourceCardId: OTHER_TWIN },
    ]);
  });

  it('does not report a conflict with zero owned even if another built deck lists it', () => {
    expect(deckCoverage(input([], [main(TARGET, 1)]), collection([], [built('1', [[TARGET, 1]])]), twins, basics).cards[0]?.allocations)
      .toEqual([{ status: 'missing', quantity: 1 }]);
  });

  it('partitions all quantities, never spends a source twice, and leaves inputs untouched', () => {
    const deck = input([COMMANDER], [main(TARGET, 3), main(TWIN, 2), main(OTHER_TWIN, 2)]);
    const heldDeck = built('1', [[TARGET, 2], [TWIN, 2], [OTHER_TWIN, 1]]);
    const copies = collection([[TARGET, 3], [TWIN, 2], [OTHER_TWIN, 3], [COMMANDER, 1]], [heldDeck]);
    const beforeDeck = structuredClone(deck);
    const beforeOwned = [...copies.owned];
    const beforeHeld = [...heldDeck.copies];
    const beforeTwins = [...twins];
    const beforeBasics = [...basics];
    const result = deckCoverage(deck, copies, twins, basics);
    const used = new Map<number, number>();
    for (const card of result.cards) {
      expect(card.allocations.every((a) => a.quantity > 0)).toBe(true);
      expect(card.allocations.reduce((sum, a) => sum + a.quantity, 0)).toBe(card.quantity);
      for (const allocation of card.allocations) {
        if (allocation.status === 'owned' || allocation.status === 'stand-in' || allocation.status === 'conflict') {
          const source = allocation.status === 'owned' ? card.cardId : allocation.sourceCardId;
          used.set(source, (used.get(source) ?? 0) + allocation.quantity);
        }
      }
    }
    for (const [source, quantity] of used) expect(quantity).toBeLessThanOrEqual(copies.owned.get(source) ?? 0);
    expect(result.owned + result.standIn + result.basic + result.conflict + result.missing).toBe(result.total);
    expect(deck).toEqual(beforeDeck);
    expect([...copies.owned]).toEqual(beforeOwned);
    expect([...heldDeck.copies]).toEqual(beforeHeld);
    expect([...twins]).toEqual(beforeTwins);
    expect([...basics]).toEqual(beforeBasics);
  });
});
