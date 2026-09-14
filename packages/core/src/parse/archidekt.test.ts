import { describe, expect, it } from 'vitest';
import { archidektDeckId, archidektDecklist } from './archidekt';
import { parseDecklist } from './decklist';

const entry = (name: string, categories: string[], quantity = 1) => ({ quantity, categories, card: { oracleCard: { name } } });

describe('archidektDeckId', () => {
  it('reads the id from deck links, with or without a slug or www', () => {
    expect(archidektDeckId('https://archidekt.com/decks/123456/liesa_angels')).toBe(123456);
    expect(archidektDeckId('  https://www.archidekt.com/decks/42  ')).toBe(42);
    expect(archidektDeckId('https://archidekt.com/api/decks/7/')).toBe(7);
  });

  it('rejects other sites and non-deck pages', () => {
    expect(archidektDeckId('https://moxfield.com/decks/abc123')).toBeNull();
    expect(archidektDeckId('https://archidekt.com/search/decks')).toBeNull();
    expect(archidektDeckId('1 Sol Ring')).toBeNull();
  });
});

describe('archidektDecklist', () => {
  const body = {
    name: 'Angels of the Night',
    categories: [
      { name: 'Commander', includedInDeck: true },
      { name: 'Ramp', includedInDeck: true },
      { name: 'Sideboard', includedInDeck: true },
      { name: 'Maybeboard', includedInDeck: false },
    ],
    cards: [
      entry('Liesa, Forgotten Archangel', ['Commander']),
      entry('Sol Ring', ['Ramp']),
      entry('Plains', ['Land'], 12),
      entry('Swords to Plowshares', ['Sideboard']),
      entry('Lyra Dawnbringer', ['Maybeboard']),
      entry('Arcane Signet', ['Ramp', 'Maybeboard']),
    ],
  };

  it('puts commanders and deck cards in their sections and leaves out sideboard and maybeboard cards', () => {
    const result = archidektDecklist(body);
    expect(result?.name).toBe('Angels of the Night');
    const { lines } = parseDecklist(result?.text ?? '');
    expect(lines.map((l) => [l.section, l.quantity, l.name])).toEqual([
      ['commander', 1, 'Liesa, Forgotten Archangel'],
      ['main', 1, 'Sol Ring'],
      ['main', 12, 'Plains'],
      ['main', 1, 'Arcane Signet'],
    ]);
  });

  it('returns null for responses that are not a deck', () => {
    expect(archidektDecklist({ detail: 'Not found.' })).toBeNull();
    expect(archidektDecklist({ ...body, cards: [{ quantity: 1, card: {} }] })).toBeNull();
  });
});
