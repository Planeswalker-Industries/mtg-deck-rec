import { describe, expect, it } from 'vitest';
import type { CardId, DeckInput, ResolvedCollectionRow } from '../contract';
import { collectionShortfall, ownedCounts, shortfallRows, withShortfallAdded } from './shortfall';

const id = (n: number) => n as CardId;
const PLAINS = id(1);
const SOL_RING = id(2);
const LIESA = id(3);
const ARCANE_SIGNET = id(4);

const deck: DeckInput = {
  commanders: [LIESA],
  cards: [
    { cardId: LIESA, quantity: 1, section: 'commander' },
    { cardId: PLAINS, quantity: 12, section: 'main' },
    { cardId: SOL_RING, quantity: 1, section: 'main' },
    { cardId: ARCANE_SIGNET, quantity: 1, section: 'main' },
  ],
};

const row = (cardId: CardId, quantity: number, rowNo: number): ResolvedCollectionRow => ({
  rowNo,
  printingId: null,
  cardId,
  finish: 'nonfoil',
  condition: 'NM',
  lang: 'en',
  quantity,
  via: 'name_only',
  setCode: null,
});

describe('collectionShortfall', () => {
  it('lists the copies the deck uses beyond what is owned, counting the commander once', () => {
    const owned = new Map([
      [PLAINS, 5],
      [SOL_RING, 1],
    ]);
    expect(collectionShortfall(deck, owned)).toEqual([
      { cardId: LIESA, missing: 1 },
      { cardId: PLAINS, missing: 7 },
      { cardId: ARCANE_SIGNET, missing: 1 },
    ]);
  });

  it('is empty when the collection covers the deck', () => {
    const owned = new Map([
      [LIESA, 1],
      [PLAINS, 20],
      [SOL_RING, 1],
      [ARCANE_SIGNET, 2],
    ]);
    expect(collectionShortfall(deck, owned)).toEqual([]);
  });
});

describe('adding the shortfall to a collection', () => {
  it('tops a browser collection up to what the deck uses', () => {
    const rows = [row(PLAINS, 5, 1)];
    const next = withShortfallAdded(rows, collectionShortfall(deck, ownedCounts(rows)));
    const counts = ownedCounts(next);
    expect(counts.get(PLAINS)).toBe(12);
    expect(counts.get(LIESA)).toBe(1);
    expect(collectionShortfall(deck, counts)).toEqual([]);
  });

  it('turns the shortfall into generic rows for an account merge', () => {
    expect(shortfallRows([{ cardId: PLAINS, missing: 7 }])).toEqual([row(PLAINS, 7, 1)]);
  });
});
