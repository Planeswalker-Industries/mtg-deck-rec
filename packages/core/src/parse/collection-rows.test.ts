import { describe, expect, it } from 'vitest';
import type { CollectionRowInput } from '../contract';
import {
  MAX_CARD_COPIES,
  MAX_COLLECTION_NAME_CHARS,
  MAX_COLLECTOR_NUMBER_CHARS,
  MAX_CONDITION_CHARS,
  resolveCollectionRowsInputSchema,
} from '../contract/schemas';
import { looksLikeBinary, splitCollectionRows } from './collection-rows';

const CLEAN: CollectionRowInput = {
  rowNo: 1,
  name: 'Sol Ring',
  scryfallId: 'c85c5f06-dd31-4e2c-97be-2f64d65069ea',
  setCode: 'C21',
  collectorNumber: '263',
  lang: 'en',
  finish: 'nonfoil',
  condition: 'near_mint',
  quantity: 2,
};

const MANABOX =
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Added\r\n' +
  'Goblin Glasswright // Craft with Pride,SOS,Secrets of Strixhaven,117,foil,common,1,112687,c85c5f06-dd31-4e2c-97be-2f64d65069ea,0.28,false,false,near_mint,en,USD,2026-08-12T01:13:03.435Z\r\n' +
  '"Page, Loose Leaf",SOS,Secrets of Strixhaven,250,normal,common,1,112642,8c6fecfd-8241-4cf0-b1eb-19472b99e0ed,0.24,false,false,near_mint,en,USD,2026-08-12T01:13:03.512Z\r\n';

describe('splitCollectionRows', () => {
  it('skips a row over MAX_CARD_COPIES', () => {
    expect(splitCollectionRows([{ ...CLEAN, quantity: MAX_CARD_COPIES + 1 }])).toEqual({ rows: [], skipped: [1] });
  });

  it('skips a row with a 201-character name', () => {
    const name = 'x'.repeat(MAX_COLLECTION_NAME_CHARS + 1);
    expect(splitCollectionRows([{ ...CLEAN, name }])).toEqual({ rows: [], skipped: [1] });
  });

  it('keeps a 200-character name', () => {
    const row = { ...CLEAN, name: 'x'.repeat(MAX_COLLECTION_NAME_CHARS) };
    expect(splitCollectionRows([row])).toEqual({ rows: [row], skipped: [] });
  });

  it('drops a 33-character condition and keeps the row', () => {
    const { condition: _condition, ...rest } = CLEAN;
    const out = splitCollectionRows([{ ...CLEAN, condition: 'x'.repeat(MAX_CONDITION_CHARS + 1) }]);
    expect(out).toEqual({ rows: [rest], skipped: [] });
  });

  it('drops a 17-character collector number and keeps the row', () => {
    const { collectorNumber: _collectorNumber, ...rest } = CLEAN;
    const out = splitCollectionRows([{ ...CLEAN, collectorNumber: '1'.repeat(MAX_COLLECTOR_NUMBER_CHARS + 1) }]);
    expect(out).toEqual({ rows: [rest], skipped: [] });
  });

  it('keeps a clean row unchanged', () => {
    const out = splitCollectionRows([CLEAN]);
    expect(out.skipped).toEqual([]);
    expect(out.rows[0]).toBe(CLEAN);
  });

  it('every kept row passes resolveCollectionRowsInputSchema', () => {
    const long = 'x'.repeat(MAX_COLLECTION_NAME_CHARS);
    const input: CollectionRowInput[] = [
      CLEAN,
      { ...CLEAN, rowNo: 2, quantity: MAX_CARD_COPIES + 1 },
      { ...CLEAN, rowNo: 3, name: `${long}x` },
      { ...CLEAN, rowNo: 4, setCode: long, collectorNumber: long, lang: long, condition: long, scryfallId: long },
      { rowNo: 5, name: 'Island', quantity: 10 },
    ];
    const out = splitCollectionRows(input);
    expect(out.skipped).toEqual([2, 3]);
    expect(out.rows.map((r) => r.rowNo)).toEqual([1, 4, 5]);
    expect(resolveCollectionRowsInputSchema.safeParse({ rows: out.rows }).success).toBe(true);
  });
});

describe('looksLikeBinary', () => {
  it('looksLikeBinary is true for text with a NUL', () => {
    expect(looksLikeBinary('PK\u0003\u0004\0\0content.xml')).toBe(true);
  });

  it('looksLikeBinary is false for a ManaBox CSV header and rows', () => {
    expect(looksLikeBinary(MANABOX)).toBe(false);
  });
});
