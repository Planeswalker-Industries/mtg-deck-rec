import { describe, expect, it } from 'vitest';
import type { CardId, PrintingId, ResolvedCollectionRow } from '../contract';
import { cardQuantity, setCardQuantity } from './edit';

const SOL = 7 as CardId;
const row = (rowNo: number, quantity: number, printing: string | null, cardId = SOL): ResolvedCollectionRow => ({
  rowNo,
  printingId: printing as PrintingId | null,
  cardId,
  finish: printing ? 'foil' : 'nonfoil',
  condition: 'NM',
  lang: 'en',
  quantity,
  via: printing ? 'scryfall_id' : 'name_only',
  setCode: printing ? 'C21' : null,
});

const imported = [row(1, 3, 'p1'), row(2, 1, null, 9 as CardId)];

describe('setCardQuantity', () => {
  it('adds copies to a new generic row and leaves the imported printing alone', () => {
    const next = setCardQuantity(imported, SOL, 5);
    expect(cardQuantity(next, SOL)).toBe(5);
    expect(next.find((r) => r.printingId === 'p1')?.quantity).toBe(3);
    expect(next.find((r) => r.cardId === SOL && r.printingId === null)).toMatchObject({ quantity: 2, finish: 'nonfoil', rowNo: 3 });
  });

  it('adds to an existing generic row rather than making another', () => {
    const next = setCardQuantity(setCardQuantity(imported, SOL, 4), SOL, 6);
    expect(next.filter((r) => r.cardId === SOL && r.printingId === null)).toHaveLength(1);
    expect(cardQuantity(next, SOL)).toBe(6);
  });

  it('takes from the generic row first, then the printing', () => {
    const five = setCardQuantity(imported, SOL, 5);
    const four = setCardQuantity(five, SOL, 4);
    expect(four.find((r) => r.cardId === SOL && r.printingId === null)?.quantity).toBe(1);
    const two = setCardQuantity(four, SOL, 2);
    expect(two.some((r) => r.cardId === SOL && r.printingId === null)).toBe(false);
    expect(two.find((r) => r.printingId === 'p1')?.quantity).toBe(2);
  });

  it('removes the card at 0 and leaves other cards untouched', () => {
    const next = setCardQuantity(imported, SOL, 0);
    expect(cardQuantity(next, SOL)).toBe(0);
    expect(next).toEqual([imported[1]]);
  });

  it('adds a card the collection did not have', () => {
    expect(cardQuantity(setCardQuantity(imported, 11 as CardId, 2), 11 as CardId)).toBe(2);
  });
});
