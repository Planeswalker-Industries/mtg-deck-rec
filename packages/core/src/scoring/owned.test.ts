import { describe, expect, it } from 'vitest';
import type { CardId } from '../contract';
import { ownedFirst, ownedOnly, rankKey } from './owned';

const session = { kind: 'session' as const, catalogEpoch: 'x', ownedCardIds: [1 as CardId] };

describe('collection modes', () => {
  it("treats an omitted mode as 'only', and nothing as either without a collection", () => {
    expect(ownedOnly({ ownership: session })).toBe(true);
    expect(ownedOnly({ ownership: session, ownershipMode: 'first' })).toBe(false);
    expect(ownedFirst({ ownership: session, ownershipMode: 'first' })).toBe(true);
    expect(ownedOnly({ ownership: null, ownershipMode: 'only' })).toBe(false);
    expect(ownedFirst({ ownership: null, ownershipMode: 'first' })).toBe(false);
  });

  it('moves owned cards up by the boost without touching unowned ones', () => {
    expect(rankKey(0.5, true, 0.1)).toBeCloseTo(0.6);
    expect(rankKey(0.5, false, 0.1)).toBe(0.5);
    expect(rankKey(0.5, true, 0)).toBe(0.5);
  });
});
