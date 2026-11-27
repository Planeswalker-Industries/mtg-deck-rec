import { describe, expect, it } from 'vitest';
import { isCollectionVersion, planCollections, type CollectionInfo } from './aliases';

const collection = (name: string, numDocuments = 10): CollectionInfo => ({ name, numDocuments });
const plan = (collections: CollectionInfo[], aliases: Record<string, string | null> = {}) =>
  planCollections(['cards'], collections, aliases)[0];

describe('isCollectionVersion', () => {
  it('matches the name, an underscore and digits only', () => {
    expect(isCollectionVersion('cards', 'cards_1789000000000')).toBe(true);
    expect(isCollectionVersion('cards', 'cards_1')).toBe(true);
    for (const other of [
      'cards',
      'cards_',
      'cards_tmp',
      'cards_12x',
      'cardsx_123',
      'cards_extra_123',
      'commander_cards_123',
      'xcards_123',
    ]) {
      expect(isCollectionVersion('cards', other), other).toBe(false);
    }
  });

  it('takes the name literally, never as a pattern', () => {
    expect(isCollectionVersion('c.rds', 'cards_123')).toBe(false);
    expect(isCollectionVersion('c.rds', 'c.rds_123')).toBe(true);
  });
});

describe('planCollections', () => {
  it('leaves a name alone when its alias resolves', () => {
    expect(plan([collection('cards_100')], { cards: 'cards_100' })).toEqual({ name: 'cards', kind: 'present' });
  });

  it('leaves a plain collection alone (a first run before any rebuild)', () => {
    expect(plan([collection('cards'), collection('cards_100')])).toEqual({ name: 'cards', kind: 'present' });
  });

  it('creates the collection plain only when no version exists', () => {
    expect(plan([collection('cards_tmp'), collection('commander_cards_100')])).toEqual({ name: 'cards', kind: 'create' });
    expect(plan([])).toEqual({ name: 'cards', kind: 'create' });
  });

  it('aliases the only version', () => {
    expect(plan([collection('cards_100', 42)])).toEqual({
      name: 'cards',
      kind: 'alias',
      target: 'cards_100',
      documents: 42,
      leftovers: [],
    });
  });

  it('picks the version with the most documents over a newer half-built one', () => {
    const step = plan([collection('cards_100', 500), collection('cards_200', 20)]);
    expect(step).toEqual({ name: 'cards', kind: 'alias', target: 'cards_100', documents: 500, leftovers: [collection('cards_200', 20)] });
  });

  it('breaks a tie on the newest suffix', () => {
    const step = plan([collection('cards_200', 500), collection('cards_100', 500)]);
    expect(step).toMatchObject({ kind: 'alias', target: 'cards_200', leftovers: [collection('cards_100', 500)] });
  });

  it('compares suffixes as numbers', () => {
    expect(plan([collection('cards_999', 5), collection('cards_1000', 5)])).toMatchObject({ target: 'cards_1000' });
  });

  it('never picks a name that only looks like a version', () => {
    const step = plan([
      collection('cards_tmp', 9_000),
      collection('cards_12x', 9_000),
      collection('cardsx_123', 9_000),
      collection('cards_extra_123', 9_000),
      collection('commander_cards_123', 9_000),
      collection('cards_100', 1),
    ]);
    expect(step).toEqual({ name: 'cards', kind: 'alias', target: 'cards_100', documents: 1, leftovers: [] });
  });

  it('aliases an empty version rather than creating a plain collection', () => {
    expect(plan([collection('cards_100', 0)])).toMatchObject({ kind: 'alias', target: 'cards_100', documents: 0 });
  });

  it('plans every name on its own', () => {
    const steps = planCollections(
      ['cards', 'tags', 'commander_cards'],
      [collection('cards_100'), collection('commander_cards_100'), collection('tags_100')],
      { cards: 'cards_100', tags: null },
    );
    expect(steps.map((s) => [s.name, s.kind])).toEqual([
      ['cards', 'present'],
      ['tags', 'alias'],
      ['commander_cards', 'alias'],
    ]);
  });
});
