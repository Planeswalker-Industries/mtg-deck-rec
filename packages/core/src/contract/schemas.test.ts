import { describe, expect, it } from 'vitest';
import {
  MAX_ADD_EXCLUDE,
  MAX_COLLECTION_ROWS_PER_CALL,
  MAX_DECK_ENTRIES,
  MAX_DECKLIST_CHARS,
  MAX_VOTE_CANDIDATES_SHOWN,
  addInputSchema,
  castVoteInputSchema,
  commanderRequestInputSchema,
  parseDeckInputSchema,
  parseInput,
  recContextSchema,
  recEventInputSchema,
  buildInputSchema,
  saveCollectionBatchInputSchema,
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

  it('takes cards to leave out of adds, within a limit', () => {
    const r = parseInput(addInputSchema, { context: context(), excludeCardIds: [5, 6] });
    expect(r.ok && r.data.excludeCardIds).toEqual([5, 6]);
    expect(parseInput(addInputSchema, { context: context() }).ok).toBe(true);
    expect(parseInput(addInputSchema, { context: context(), excludeCardIds: [0] }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_ADD_EXCLUDE + 1 }, (_, i) => i + 1);
    expect(parseInput(addInputSchema, { context: context(), excludeCardIds: tooMany }).ok).toBe(false);
  });

  it('accepts only numeric lookup ids', () => {
    expect(parseInput(commanderRequestInputSchema, { requestId: '12' }).ok).toBe(true);
    expect(parseInput(commanderRequestInputSchema, { requestId: '12; drop' }).ok).toBe(false);
  });
});

describe('castVoteInputSchema', () => {
  const uuid = '0000579f-7b35-4ed3-b44c-db2a538066fe';
  const vote = (overrides: Record<string, unknown> = {}) => ({ targetCardId: 10, replacementCardId: 11, value: 1, ...overrides });
  const swipe = (overrides: Record<string, unknown> = {}) => ({
    source: 'deck',
    sessionId: uuid,
    commanderIds: [1],
    position: 0,
    shownCardIds: [11, 12],
    matchedTagIds: [uuid],
    ...overrides,
  });

  it('accepts a plain vote, a cleared vote and a vote with what the voter saw', () => {
    expect(parseInput(castVoteInputSchema, vote()).ok).toBe(true);
    expect(parseInput(castVoteInputSchema, vote({ value: 0, commanderKeyId: 7 })).ok).toBe(true);
    const r = parseInput(castVoteInputSchema, vote({ value: -1, context: swipe({ source: 'rater', commanderIds: [] }) }));
    expect(r.ok && r.data.context?.source).toBe('rater');
  });

  it("rejects a card replacing itself, other vote values and bad sittings or tags", () => {
    const self = parseInput(castVoteInputSchema, vote({ replacementCardId: 10 }));
    expect(!self.ok && self.error.message).toBe("A card can't replace itself.");
    expect(parseInput(castVoteInputSchema, vote({ value: 2 })).ok).toBe(false);
    expect(parseInput(castVoteInputSchema, vote({ context: swipe({ sessionId: 'abc' }) })).ok).toBe(false);
    expect(parseInput(castVoteInputSchema, vote({ context: swipe({ matchedTagIds: ['not-a-tag'] }) })).ok).toBe(false);
    expect(parseInput(castVoteInputSchema, vote({ context: swipe({ commanderIds: [1, 2, 3] }) })).ok).toBe(false);
    expect(parseInput(castVoteInputSchema, vote({ context: swipe({ source: 'bot' }) })).ok).toBe(false);
  });

  it('treats too many shown candidates as too large', () => {
    const shownCardIds = Array.from({ length: MAX_VOTE_CANDIDATES_SHOWN + 1 }, (_, i) => i + 1);
    const r = parseInput(castVoteInputSchema, vote({ context: swipe({ shownCardIds }) }));
    expect(!r.ok && r.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('saveCollectionBatchInputSchema', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    rowNo: 1,
    printingId: '0000579f-7b35-4ed3-b44c-db2a538066fe',
    cardId: 7,
    finish: 'foil',
    condition: 'NM',
    lang: 'en',
    quantity: 2,
    via: 'scryfall_id',
    ...overrides,
  });
  const batch = (overrides: Record<string, unknown> = {}) => ({
    importId: null,
    sourceApp: 'text',
    mode: 'merge',
    rows: [row()],
    final: true,
    ...overrides,
  });

  it('accepts a first batch and a follow-up with an import id', () => {
    expect(parseInput(saveCollectionBatchInputSchema, batch()).ok).toBe(true);
    expect(parseInput(saveCollectionBatchInputSchema, batch({ importId: '42', rows: [row({ printingId: null, via: 'name_only' })] })).ok).toBe(true);
  });

  it('rejects bad import ids, printings, finishes and quantities', () => {
    expect(parseInput(saveCollectionBatchInputSchema, batch({ importId: '42 or 1=1' })).ok).toBe(false);
    expect(parseInput(saveCollectionBatchInputSchema, batch({ rows: [row({ printingId: 'not-a-uuid' })] })).ok).toBe(false);
    expect(parseInput(saveCollectionBatchInputSchema, batch({ rows: [row({ finish: 'gold' })] })).ok).toBe(false);
    expect(parseInput(saveCollectionBatchInputSchema, batch({ rows: [row({ quantity: 0 })] })).ok).toBe(false);
    expect(parseInput(saveCollectionBatchInputSchema, batch({ mode: 'append' })).ok).toBe(false);
  });

  it('treats more than 2,000 rows as too large', () => {
    const rows = Array.from({ length: MAX_COLLECTION_ROWS_PER_CALL + 1 }, (_, i) => row({ rowNo: i }));
    const r = parseInput(saveCollectionBatchInputSchema, batch({ rows }));
    expect(!r.ok && r.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('recEventInputSchema (T065)', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    kind: 'shown',
    mode: 'add',
    batchId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    cardIds: [11, 12, 13],
    commanderIds: [1],
    bracket: 3,
    collection: 'none',
    ...overrides,
  });

  it('accepts a list shown and a decision on one of its cards', () => {
    expect(parseInput(recEventInputSchema, event()).ok).toBe(true);
    expect(parseInput(recEventInputSchema, event({ kind: 'accepted', cardIds: [12], position: 1, components: { corpus: 0.8, deck: null } })).ok).toBe(true);
  });

  it('refuses a decision without a position or with several cards, and a list with one', () => {
    expect(parseInput(recEventInputSchema, event({ kind: 'declined', cardIds: [12] })).ok).toBe(false);
    expect(parseInput(recEventInputSchema, event({ kind: 'accepted', position: 0 })).ok).toBe(false);
    expect(parseInput(recEventInputSchema, event({ position: 0 })).ok).toBe(false);
    expect(parseInput(recEventInputSchema, event({ components: { made_up: 1 }, kind: 'accepted', cardIds: [11], position: 0 })).ok).toBe(false);
  });
});

describe('buildInputSchema (T063)', () => {
  it('takes a context and an optional fill', () => {
    expect(parseInput(buildInputSchema, { context: context(), fill: 'value' }).ok).toBe(true);
    expect(parseInput(buildInputSchema, { context: context(), fill: 'everything' }).ok).toBe(false);
  });
});
