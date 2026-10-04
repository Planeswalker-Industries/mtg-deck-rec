import { describe, expect, it } from 'vitest';
import { spellbookVariant } from './commander-spellbook';

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

describe('spellbookVariant', () => {
  it('keeps the cards, results, bracket tag and combo ids', () => {
    const parsed = spellbookVariant(variant());
    expect(parsed).toEqual({
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
      popularity: 812,
      comboIds: [34222],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/salt|prices|description|image/);
  });

  it('keeps pieces that must be the commander, and named templates', () => {
    const parsed = spellbookVariant(
      variant({
        uses: [use(ORACLE_A, 'Ertha Jo, Frontier Mentor', { mustBeCommander: true })],
        requires: [{ template: { id: 212, name: 'Legendary Elemental Creature', scryfallQuery: 't:legendary' }, quantity: 1 }],
      }),
    );
    expect(parsed?.cards).toEqual([{ oracleId: ORACLE_A, name: 'Ertha Jo, Frontier Mentor', mustBeCommander: true }]);
    expect(parsed?.templates).toEqual(['Legendary Elemental Creature']);
  });

  it('lists a card once when the combo uses two copies', () => {
    const parsed = spellbookVariant(variant({ uses: [use(ORACLE_A, 'Relentless Rats', { quantity: 2 }), use(ORACLE_A, 'Relentless Rats')] }));
    expect(parsed?.cards).toHaveLength(1);
  });

  it('dedupes repeated results and combo ids', () => {
    const parsed = spellbookVariant(
      variant({ produces: [feature(24, 'Infinite card draw', 'S'), feature(24, 'Infinite card draw', 'S')], of: [{ id: 9 }, { id: 2 }, { id: 9 }] }),
    );
    expect(parsed?.features).toHaveLength(1);
    expect(parsed?.comboIds).toEqual([2, 9]);
  });

  it('reads a missing popularity or mana value as unknown and zero', () => {
    const parsed = spellbookVariant(variant({ popularity: null, manaValueNeeded: undefined }));
    expect(parsed?.popularity).toBeNull();
    expect(parsed?.manaValueNeeded).toBe(0);
  });

  it('keeps combos that are banned in Commander, tagged B', () => {
    expect(spellbookVariant(variant({ bracketTag: 'B', legalities: { commander: false } }))?.bracketTag).toBe('B');
  });

  it('drops anything that is not a published combo', () => {
    expect(spellbookVariant(null)).toBeNull();
    expect(spellbookVariant(variant({ status: 'NR' }))).toBeNull();
    expect(spellbookVariant(variant({ id: '' }))).toBeNull();
    expect(spellbookVariant(variant({ uses: [] }))).toBeNull();
    expect(spellbookVariant(variant({ bracketTag: 'X' }))).toBeNull();
    expect(spellbookVariant(variant({ bracketTag: 'toString' }))).toBeNull();
  });

  it('drops a combo with a malformed piece rather than keep it a card short', () => {
    expect(spellbookVariant(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), use('not-an-oracle-id', 'Staff')] }))).toBeNull();
    expect(spellbookVariant(variant({ uses: [use(ORACLE_A, 'Ertha Jo'), { card: null }] }))).toBeNull();
    expect(spellbookVariant(variant({ requires: [{ template: { id: 1 } }] }))).toBeNull();
    expect(spellbookVariant(variant({ produces: [feature(24, 'Infinite card draw', 'Z')] }))).toBeNull();
  });
});
