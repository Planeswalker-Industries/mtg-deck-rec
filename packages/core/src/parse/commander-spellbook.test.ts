import { describe, expect, it } from 'vitest';
import { spellbookVariant, type SpellbookCombo } from './commander-spellbook';

const ORACLE_A = '0a66ce8b-af99-411f-8ecb-52a5d2f6af3d';
const ORACLE_B = '1b2c3d4e-0000-4000-8000-000000000002';

const use = (oracleId: string, name: string, extra: Record<string, unknown> = {}) => ({
  card: { id: 5640, name, oracleId, spoiler: false, imageUriFrontPng: 'https://cards.scryfall.io/png/front/a.png' },
  zoneLocations: ['B'],
  mustBeCommander: false,
  quantity: 1,
  ...extra,
});

const feature = (id: number, name: string, status: string) => ({ feature: { id, name, uncountable: true, status }, quantity: 1 });

const variant = (extra: Record<string, unknown> = {}) => ({
  id: '2645-5640',
  status: 'OK',
  uses: [use(ORACLE_A, 'Ertha Jo, Frontier Mentor'), use(ORACLE_B, 'Staff of Domination')],
  requires: [],
  produces: [feature(24, 'Infinite card draw', 'S'), feature(3, 'Infinite creature ETB', 'H')],
  of: [{ id: 34222 }],
  includes: [{ id: 26876 }],
  identity: 'RGW',
  manaNeeded: '{3}',
  manaValueNeeded: 3,
  description: 'Activate Staff of Domination...',
  popularity: 812,
  salt: 1.4,
  bracketTag: 'S',
  legalities: { commander: true },
  prices: { tcgplayer: '10.85' },
  variantCount: 4,
  ...extra,
});

/** The combo, or a failure naming the reason it was refused. */
const parse = (body: unknown): SpellbookCombo => {
  const result = spellbookVariant(body);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.combo;
};
const refusal = (body: unknown) => {
  const result = spellbookVariant(body);
  return result.ok ? null : result.reason;
};

describe('spellbookVariant', () => {
  it('keeps the cards, results, bracket tag, EDHREC deck count and combo ids', () => {
    const combo = parse(variant());
    expect(combo).toEqual({
      id: '2645-5640',
      cards: [
        { oracleId: ORACLE_A, name: 'Ertha Jo, Frontier Mentor', mustBeCommander: false },
        { oracleId: ORACLE_B, name: 'Staff of Domination', mustBeCommander: false },
      ],
      templates: [],
      features: [
        { id: 24, name: 'Infinite card draw', status: 'S' },
        { id: 3, name: 'Infinite creature ETB', status: 'H' },
      ],
      bracketTag: 'S',
      manaValueNeeded: 3,
      edhrecDeckCount: 812,
      comboIds: [34222],
    });
    expect(JSON.stringify(combo)).not.toMatch(/salt|prices|description|image|popularity/);
  });

  it('orders the cards by oracle id, whatever order Spellbook lists them in', () => {
    const combo = parse(variant({ uses: [use(ORACLE_B, 'Staff of Domination'), use(ORACLE_A, 'Ertha Jo, Frontier Mentor')] }));
    expect(combo.cards.map((card) => card.oracleId)).toEqual([ORACLE_A, ORACLE_B]);
  });

  it('keeps pieces that must be the commander, and named templates', () => {
    const combo = parse(
      variant({
        uses: [use(ORACLE_A, 'Ertha Jo, Frontier Mentor', { mustBeCommander: true })],
        requires: [{ template: { id: 212, name: 'Legendary Elemental Creature', scryfallQuery: 't:legendary' }, quantity: 1 }],
      }),
    );
    expect(combo.cards).toEqual([{ oracleId: ORACLE_A, name: 'Ertha Jo, Frontier Mentor', mustBeCommander: true }]);
    expect(combo.templates).toEqual(['Legendary Elemental Creature']);
  });

  it('lists a card once when the combo uses two copies', () => {
    expect(parse(variant({ uses: [use(ORACLE_A, 'Relentless Rats', { quantity: 2 }), use(ORACLE_A, 'Relentless Rats')] })).cards).toHaveLength(1);
  });

  it('dedupes repeated results and combo ids', () => {
    const combo = parse(
      variant({ produces: [feature(24, 'Infinite card draw', 'S'), feature(24, 'Infinite card draw', 'S')], of: [{ id: 9 }, { id: 2 }, { id: 9 }] }),
    );
    expect(combo.features).toHaveLength(1);
    expect(combo.comboIds).toEqual([2, 9]);
  });

  it('reads a missing EDHREC deck count or mana value as unknown and zero', () => {
    const combo = parse(variant({ popularity: null, manaValueNeeded: undefined }));
    expect(combo.edhrecDeckCount).toBeNull();
    expect(combo.manaValueNeeded).toBe(0);
  });

  it('keeps tags and statuses as published, known or not, for the collator to interpret', () => {
    expect(parse(variant({ bracketTag: 'B', legalities: { commander: false } })).bracketTag).toBe('B');
    expect(parse(variant({ bracketTag: 'X' })).bracketTag).toBe('X');
    expect(parse(variant({ produces: [feature(24, 'Infinite card draw', 'Z')] })).features).toEqual([{ id: 24, name: 'Infinite card draw', status: 'Z' }]);
  });

  it('says a combo that is not published is unpublished, not malformed', () => {
    expect(refusal(variant({ status: 'NR' }))).toBe('not_published');
    expect(refusal(variant({ status: undefined }))).toBe('not_published');
  });

  it('refuses a published combo missing something structural', () => {
    expect(refusal(null)).toBe('malformed');
    expect(refusal([])).toBe('malformed');
    expect(refusal(variant({ id: '' }))).toBe('malformed');
    expect(refusal(variant({ uses: [] }))).toBe('malformed');
    expect(refusal(variant({ bracketTag: '' }))).toBe('malformed');
    expect(refusal(variant({ bracketTag: null }))).toBe('malformed');
  });

  it('refuses a combo with a malformed piece rather than keep it a card short', () => {
    expect(refusal(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), use('not-an-oracle-id', 'Staff')] }))).toBe('malformed');
    expect(refusal(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), use(ORACLE_B.toUpperCase(), 'Staff')] }))).toBe('malformed');
    expect(refusal(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), use(ORACLE_B, '')] }))).toBe('malformed');
    expect(refusal(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), { card: null }] }))).toBe('malformed');
    expect(refusal(variant({ requires: [{ template: { id: 1 } }] }))).toBe('malformed');
    expect(refusal(variant({ produces: [{ feature: { id: 24, name: 'Infinite card draw' } }] }))).toBe('malformed');
  });
});
