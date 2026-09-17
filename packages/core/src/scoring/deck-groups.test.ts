import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, TagId, TagRef } from '../contract';
import { groupDeck, type DeckEntry } from './deck-groups';

const card = (id: number, name: string, typeLine: string, keywords: string[] = []): CardSummary => ({
  id: id as CardId,
  oracleId: `oracle-${id}` as CardSummary['oracleId'],
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  manaValue: 1,
  typeLine,
  colorIdentity: 'W',
  images: null,
  gameChanger: false,
  released: true,
  price: null,
  keywords,
});

const tag = (label: string): TagRef => ({ id: `tag-${label}` as TagId, slug: label, label });

const entry = (c: CardSummary, quantity = 1): DeckEntry => ({ card: c, quantity });

describe('groupDeck by type', () => {
  it('splits Legendary Creature out from Creature', () => {
    const groups = groupDeck(
      [entry(card(1, 'Liesa', 'Legendary Creature — Angel')), entry(card(2, 'Bear', 'Creature — Bear'))],
      'type',
    );
    expect(groups.map((g) => g.label)).toEqual(['Legendary Creature', 'Creature']);
  });

  it('keeps the decklist order and counts copies, not cards', () => {
    const groups = groupDeck(
      [entry(card(1, 'Plains', 'Basic Land — Plains'), 10), entry(card(2, 'Bolt', 'Instant'))],
      'type',
    );
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Instant', 1],
      ['Land', 10],
    ]);
  });

  it('uses the front face of a double-faced card', () => {
    const groups = groupDeck([entry(card(1, 'Sea Gate', 'Sorcery // Land'))], 'type');
    expect(groups[0]?.label).toBe('Sorcery');
  });

  it('puts an unrecognised type in Other rather than dropping it', () => {
    const groups = groupDeck([entry(card(1, 'Odd', 'Dungeon'))], 'type');
    expect(groups.map((g) => g.label)).toEqual(['Other']);
  });
});

describe('groupDeck by keyword', () => {
  it('puts a card in every keyword it has', () => {
    const groups = groupDeck([entry(card(1, 'Liesa', 'Creature', ['Flying', 'Lifelink']))], 'keyword');
    expect(groups.map((g) => g.label).sort()).toEqual(['Flying', 'Lifelink']);
  });

  it('collects cards with no keyword rather than dropping them', () => {
    const groups = groupDeck(
      [entry(card(1, 'Flier', 'Creature', ['Flying'])), entry(card(2, 'Sol Ring', 'Artifact'))],
      'keyword',
    );
    expect(groups.map((g) => g.label)).toEqual(['Flying', 'No keyword']);
    expect(groups.at(-1)?.entries).toHaveLength(1);
  });

  it('orders the biggest group first', () => {
    const groups = groupDeck(
      [
        entry(card(1, 'A', 'Creature', ['Flying'])),
        entry(card(2, 'B', 'Creature', ['Flying'])),
        entry(card(3, 'C', 'Creature', ['Trample'])),
      ],
      'keyword',
    );
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Flying', 2],
      ['Trample', 1],
    ]);
  });
});

describe('groupDeck by tag', () => {
  const swords = card(1, 'Swords to Plowshares', 'Instant');
  const solRing = card(2, 'Sol Ring', 'Artifact');
  const tags = new Map([
    [1, [tag('removal'), tag('lifegain')]],
    [2, [tag('ramp')]],
  ]);

  it('puts a card in every tag it carries, so counts do not sum to the deck size', () => {
    const groups = groupDeck([entry(swords), entry(solRing)], 'tag', tags);
    expect(groups.map((g) => g.label).sort()).toEqual(['lifegain', 'ramp', 'removal']);
    // Two cards, three group memberships.
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(3);
  });

  it('collects untagged cards rather than dropping them', () => {
    const groups = groupDeck([entry(swords), entry(card(3, 'Mystery', 'Instant'))], 'tag', tags);
    expect(groups.at(-1)?.label).toBe('No tag');
  });

  it('returns only the untagged group when no tags are known yet', () => {
    const groups = groupDeck([entry(swords)], 'tag');
    expect(groups.map((g) => g.label)).toEqual(['No tag']);
  });
});

describe('groupDeck group ceiling', () => {
  it('keeps the largest groups and sweeps the rest into Other without losing a card', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(card(i + 1, `Card ${i}`, 'Creature')));
    // Every card has its own rare tag; two share a common one.
    const tags = new Map(entries.map((e, i) => [i + 1, [tag(`rare-${i}`)]]));
    tags.set(1, [tag('common'), tag('rare-0')]);
    tags.set(2, [tag('common'), tag('rare-1')]);

    const groups = groupDeck(entries, 'tag', tags, { maxGroups: 1 });
    expect(groups.map((g) => g.label)).toEqual(['common', 'Other']);
    // All ten cards are still reachable: two in the kept group, eight swept up.
    const seen = new Set(groups.flatMap((g) => g.entries.map((e) => e.card.id)));
    expect(seen.size).toBe(10);
  });

  it('does not cap when the groups already fit', () => {
    const groups = groupDeck([entry(card(1, 'A', 'Creature', ['Flying']))], 'keyword', new Map(), { maxGroups: 12 });
    expect(groups.map((g) => g.label)).toEqual(['Flying']);
  });
});
