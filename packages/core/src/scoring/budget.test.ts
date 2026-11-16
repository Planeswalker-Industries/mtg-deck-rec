import { describe, expect, it } from 'vitest';
import type { CardSummary } from '../contract/cards';
import type { IsoDateTime } from '../contract/ids';
import { effectiveCapUsd, requestBudget, withinBudget } from './budget';

const AS_OF = '2026-11-15T00:00:00Z' as IsoDateTime;
const priced = (usd: number): Pick<CardSummary, 'price'> => ({ price: { usd, finish: 'nonfoil', asOf: AS_OF, source: 'scryfall' } });
const unpriced: Pick<CardSummary, 'price'> = { price: null };

describe('effectiveCapUsd', () => {
  it('takes the lower of the two fields', () => {
    expect(effectiveCapUsd({ cardCapUsd: 5, spendLeftUsd: 3 })).toBe(3);
    expect(effectiveCapUsd({ cardCapUsd: 2, spendLeftUsd: 30 })).toBe(2);
  });

  it('takes the one field that is set', () => {
    expect(effectiveCapUsd({ cardCapUsd: 5 })).toBe(5);
    expect(effectiveCapUsd({ spendLeftUsd: 0 })).toBe(0);
  });

  it('is null without a budget', () => {
    expect(effectiveCapUsd({})).toBeNull();
    expect(effectiveCapUsd(undefined)).toBeNull();
  });
});

describe('requestBudget', () => {
  it('is none without a budget', () => {
    expect(requestBudget(undefined)).toBeUndefined();
    expect(requestBudget({})).toBeUndefined();
  });

  it('carries the cap as set and the spend left, never below 0', () => {
    expect(requestBudget({ cardCapUsd: 5 }, 12)).toEqual({ cardCapUsd: 5 });
    expect(requestBudget({ cardCapUsd: 5, spendUsd: 50 }, 12.3)).toEqual({ cardCapUsd: 5, spendLeftUsd: 37.7 });
    expect(requestBudget({ spendUsd: 10 }, 15)).toEqual({ spendLeftUsd: 0 });
  });
});

describe('withinBudget', () => {
  it('passes a supplied card over the cap', () => expect(withinBudget(priced(50), true, false, 5)).toBe(true));
  it('passes a basic land', () => expect(withinBudget(unpriced, false, true, 0)).toBe(true));
  it('leaves out an unpriced unowned card under a cap', () => expect(withinBudget(unpriced, false, false, 5)).toBe(false));
  it('passes a card at the cap', () => expect(withinBudget(priced(5), false, false, 5)).toBe(true));
  it('leaves out a card over the cap', () => expect(withinBudget(priced(5.01), false, false, 5)).toBe(false));
  it('passes everything without a cap', () => {
    expect(withinBudget(priced(500), false, false, null)).toBe(true);
    expect(withinBudget(unpriced, false, false, null)).toBe(true);
  });
});
