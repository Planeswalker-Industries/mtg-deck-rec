import { describe, expect, it } from 'vitest';
import { compareCards, type CompareCard } from './compare';

const card = (over: Partial<CompareCard> = {}): CompareCard => ({
  manaValue: 3,
  typeLine: 'Sorcery',
  keywords: [],
  priceUsd: null,
  inclusionRate: null,
  power: null,
  toughness: null,
  ...over,
});

describe('compareCards', () => {
  it('marks a cheaper, faster, more played and cheaper-to-buy replacement as better on each', () => {
    const out = card({ manaValue: 3, typeLine: 'Sorcery', priceUsd: 3, inclusionRate: 0.2 });
    const inc = card({ manaValue: 2, typeLine: 'Instant', priceUsd: 1, inclusionRate: 0.4 });
    expect(compareCards(out, inc)).toEqual([
      { key: 'cost', tone: 'better', label: '1 cheaper to cast' },
      { key: 'speed', tone: 'better', label: 'Instant speed' },
      { key: 'play', tone: 'better', label: 'In 20 points more decks' },
      { key: 'price', tone: 'better', label: '$2.00 cheaper' },
    ]);
  });

  it('marks the opposite as worse, and counts flash as instant speed', () => {
    const out = card({ manaValue: 2, typeLine: 'Creature — Faerie', keywords: ['Flash', 'Flying'] });
    const inc = card({ manaValue: 4, typeLine: 'Creature — Bird' });
    expect(compareCards(out, inc)).toEqual([
      { key: 'cost', tone: 'worse', label: '2 more to cast' },
      { key: 'speed', tone: 'worse', label: 'Sorcery speed' },
    ]);
  });

  it('compares bodies only when both are plain numbers and one is bigger all round', () => {
    const bear = card({ typeLine: 'Creature — Bear', power: '2', toughness: '2' });
    expect(compareCards(bear, card({ typeLine: 'Creature — Bear', power: '3', toughness: '2' }))).toContainEqual({
      key: 'body',
      tone: 'better',
      label: 'Bigger: 3/2 body',
    });
    expect(compareCards(bear, card({ typeLine: 'Creature — Wall', power: '0', toughness: '4' })).map((m) => m.key)).not.toContain('body');
    expect(compareCards(bear, card({ typeLine: 'Creature — Lhurgoyf', power: '*', toughness: '1+*' })).map((m) => m.key)).not.toContain('body');
  });

  it('leaves out small gaps and anything a card lacks, and never compares cost or speed with a land', () => {
    const out = card({ priceUsd: 1, inclusionRate: 0.3 });
    expect(compareCards(out, card({ priceUsd: 1.2, inclusionRate: 0.32 }))).toEqual([]);
    expect(compareCards(out, card({ priceUsd: null, inclusionRate: null }))).toEqual([]);
    expect(compareCards(card({ typeLine: 'Land', manaValue: 0 }), card({ typeLine: 'Instant', manaValue: 2 }))).toEqual([]);
  });
});
