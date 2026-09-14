import { describe, expect, it } from 'vitest';
import {
  MAX_DECK_ENTRIES,
  MAX_DECKLIST_CHARS,
  commanderRequestInputSchema,
  parseDeckInputSchema,
  parseInput,
  recContextSchema,
  swapInputSchema,
} from './schemas';

const context = (overrides: Record<string, unknown> = {}) => ({
  deck: { commanders: [1], cards: [{ cardId: 2, quantity: 1, section: 'main' }] },
  bracket: 3,
  bracketSource: 'inferred',
  includeGameChangers: true,
  ...overrides,
});

describe('recContextSchema', () => {
  it('accepts a collection-less context and fills in ownership', () => {
    const r = parseInput(recContextSchema, context());
    expect(r.ok && r.data.ownership).toBeNull();
    expect(r.ok && r.data.deck.cards[0]?.cardId).toBe(2);
  });

  it('accepts session and account collections', () => {
    const session = parseInput(recContextSchema, context({ ownership: { kind: 'session', catalogEpoch: 'e1', ownedCardIds: [3, 4] } }));
    expect(session.ok && session.data.ownership).toEqual({ kind: 'session', catalogEpoch: 'e1', ownedCardIds: [3, 4] });
    const account = parseInput(recContextSchema, context({ ownership: { kind: 'account' } }));
    expect(account.ok && account.data.ownership?.kind).toBe('account');
  });

  it('rejects a bad bracket with a readable message and its field', () => {
    const r = parseInput(recContextSchema, context({ bracket: 6 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('VALIDATION');
    expect(r.error.message).toBe('Pick a bracket from 1 to 5.');
    expect(r.error.fieldErrors?.bracket).toEqual(['Pick a bracket from 1 to 5.']);
  });

  it('rejects three commanders and non-integer card ids', () => {
    expect(parseInput(recContextSchema, context({ deck: { commanders: [1, 2, 3], cards: [] } })).ok).toBe(false);
    expect(parseInput(recContextSchema, context({ deck: { commanders: [1.5], cards: [] } })).ok).toBe(false);
    expect(parseInput(recContextSchema, null).ok).toBe(false);
  });

  it('treats an oversized deck as too large, not merely invalid', () => {
    const cards = Array.from({ length: MAX_DECK_ENTRIES + 1 }, (_, i) => ({ cardId: i + 1, quantity: 1, section: 'main' }));
    const r = parseInput(recContextSchema, context({ deck: { commanders: [1], cards } }));
    expect(!r.ok && r.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('keeps too many copies a validation error', () => {
    const r = parseInput(recContextSchema, context({ deck: { commanders: [1], cards: [{ cardId: 2, quantity: 999, section: 'main' }] } }));
    expect(!r.ok && r.error.code).toBe('VALIDATION');
  });
});

describe('action and route inputs', () => {
  it('requires a card to replace', () => {
    const r = parseInput(swapInputSchema, { context: context() });
    expect(!r.ok && r.error.message).toBe('Pick a card to replace.');
  });

  it('limits decklist text', () => {
    expect(parseInput(parseDeckInputSchema, { text: 'x'.repeat(MAX_DECKLIST_CHARS) }).ok).toBe(true);
    const tooLong = parseInput(parseDeckInputSchema, { text: 'x'.repeat(MAX_DECKLIST_CHARS + 1) });
    expect(!tooLong.ok && tooLong.error.code).toBe('PAYLOAD_TOO_LARGE');
    const notText = parseInput(parseDeckInputSchema, { text: 42 });
    expect(!notText.ok && notText.error.message).toBe('Send the decklist as text.');
  });

  it('accepts only numeric lookup ids', () => {
    expect(parseInput(commanderRequestInputSchema, { requestId: '12' }).ok).toBe(true);
    expect(parseInput(commanderRequestInputSchema, { requestId: '12; drop' }).ok).toBe(false);
  });
});
