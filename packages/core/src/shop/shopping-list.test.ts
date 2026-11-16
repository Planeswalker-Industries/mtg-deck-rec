import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, IsoDateTime, OracleId } from '../contract';
import type { DeckCoverage } from '../collection/coverage';
import { missingFromCoverage, shoppingList, type ShoppingLine } from './shopping-list';

const OLD = '2026-11-10T00:00:00Z' as IsoDateTime;
const NEW = '2026-11-15T00:00:00Z' as IsoDateTime;

const summary = (id: number, name: string, typeLine: string, usd: number | null, asOf: IsoDateTime = NEW): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as OracleId,
  name,
  slug: name.toLowerCase().replace(/\W+/g, '-'),
  manaValue: 2,
  manaCost: '{1}{G}',
  typeLine,
  colorIdentity: 'G',
  images: null,
  gameChanger: false,
  released: true,
  keywords: [],
  price: usd === null ? null : { usd, finish: 'nonfoil', asOf, source: 'scryfall' },
});

const commander = summary(1, 'Elf Lord', 'Legendary Creature — Elf', 3.5);
const elf = summary(2, 'Elf', 'Creature — Elf', 0.25);
const bolt = summary(3, 'Bolt', 'Instant', 1.1, OLD);
const ring = summary(4, 'Ring', 'Artifact', null);
const forest = summary(5, 'Forest', 'Basic Land — Forest', 0.1);
const dryad = summary(6, 'Dryad Arbor', 'Land Creature — Forest Dryad', 0.6);
const grove = summary(7, 'Grove', 'Land', 2);

const entries: ShoppingLine[] = [
  { card: commander, quantity: 1 },
  { card: elf, quantity: 1 },
  { card: bolt, quantity: 1 },
  { card: ring, quantity: 1 },
  { card: forest, quantity: 30 },
  { card: dryad, quantity: 1 },
  { card: grove, quantity: 1 },
];
const ids = (list: ReturnType<typeof shoppingList>) => list.groups.map((g) => [g.category, g.lines.map((l) => l.card.name)]);

describe('shoppingList', () => {
  it('lists the copies the collection is missing, whatever the scope', () => {
    const missing = new Map<CardId, number>([
      [bolt.id, 1],
      [forest.id, 12],
      [grove.id, 1],
    ]);
    const list = shoppingList({ entries, missing, roundIds: [], scope: 'round' });
    expect(ids(list)).toEqual([
      ['instant', ['Bolt']],
      ['land', ['Grove']],
    ]);
    expect(list.count).toBe(2);
  });

  it('lists only the round cards in round scope', () => {
    const list = shoppingList({ entries, missing: null, roundIds: [grove.id, bolt.id], scope: 'round' });
    expect(ids(list)).toEqual([
      ['instant', ['Bolt']],
      ['land', ['Grove']],
    ]);
  });

  it('lists the whole deck in deck scope, never the basics', () => {
    const list = shoppingList({ entries, missing: null, roundIds: [], scope: 'deck' });
    expect(ids(list)).toEqual([
      ['creature', ['Elf Lord', 'Elf', 'Dryad Arbor']],
      ['instant', ['Bolt']],
      ['artifact', ['Ring']],
      ['land', ['Grove']],
    ]);
  });

  it('puts the round cards first in their order, then deck order', () => {
    const list = shoppingList({ entries, missing: null, roundIds: [dryad.id, elf.id], scope: 'deck' });
    expect(list.groups[0]?.lines.map((l) => l.card.name)).toEqual(['Dryad Arbor', 'Elf', 'Elf Lord']);
  });

  it('totals priced copies in whole cents and counts the unpriced apart', () => {
    const missing = new Map<CardId, number>([
      [elf.id, 3],
      [bolt.id, 1],
      [ring.id, 2],
    ]);
    const list = shoppingList({ entries, missing, roundIds: [], scope: 'deck' });
    expect(list.count).toBe(6);
    expect(list.totalUsd).toBe(1.85);
    expect(list.unpriced).toBe(2);
    expect(list.asOf).toBe(NEW);
  });

  it('is empty with nothing missing', () => {
    const list = shoppingList({ entries, missing: new Map(), roundIds: [elf.id], scope: 'round' });
    expect(list).toEqual({ groups: [], count: 0, totalUsd: 0, unpriced: 0, asOf: null });
  });
});

describe('missingFromCoverage', () => {
  it('sums only the missing allocations', () => {
    const coverage: DeckCoverage = {
      total: 0,
      owned: 0,
      standIn: 0,
      basic: 0,
      conflict: 0,
      missing: 0,
      cards: [
        { cardId: elf.id, quantity: 1, allocations: [{ status: 'owned', quantity: 1 }] },
        { cardId: bolt.id, quantity: 1, allocations: [{ status: 'conflict', quantity: 1, sourceCardId: bolt.id, decks: [] }] },
        {
          cardId: ring.id,
          quantity: 3,
          allocations: [
            { status: 'owned', quantity: 1 },
            { status: 'missing', quantity: 2 },
          ],
        },
      ],
    };
    expect([...missingFromCoverage(coverage)]).toEqual([[ring.id, 2]]);
  });
});
