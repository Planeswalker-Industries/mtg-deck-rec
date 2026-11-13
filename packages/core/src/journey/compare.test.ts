import { describe, expect, it } from 'vitest';
import { compareCards, type CompareCard } from './compare';

const card = (over: Partial<CompareCard> = {}): CompareCard => ({
  manaValue: 3,
  typeLine: 'Sorcery',
  keywords: [],
  inclusionRate: null,
  power: null,
  toughness: null,
  ...over,
});

describe('compareCards', () => {
  it('marks a cheaper, faster and more played replacement as better on each, the arrow following the thing itself', () => {
    const out = card({ manaValue: 3, typeLine: 'Sorcery', inclusionRate: 0.2 });
    const inc = card({ manaValue: 2, typeLine: 'Instant', inclusionRate: 0.4 });
    expect(compareCards(out, inc)).toEqual([
      { key: 'cost', tone: 'better', direction: 'down', label: 'Cost', detail: '1 cheaper to cast' },
      { key: 'speed', tone: 'better', direction: 'up', label: 'Speed', detail: 'instant speed' },
      { key: 'play', tone: 'better', direction: 'up', label: 'Popular', detail: 'played more with this commander' },
    ]);
  });

  it('marks the opposite as worse, and counts flash as instant speed', () => {
    const out = card({ manaValue: 2, typeLine: 'Creature — Faerie', keywords: ['Flash', 'Flying'] });
    const inc = card({ manaValue: 4, typeLine: 'Creature — Bird' });
    expect(compareCards(out, inc)).toEqual([
      { key: 'cost', tone: 'worse', direction: 'up', label: 'Cost', detail: '2 more to cast' },
      { key: 'speed', tone: 'worse', direction: 'down', label: 'Speed', detail: 'sorcery speed' },
    ]);
  });

  it('compares bodies only when both are plain numbers and one is bigger all round', () => {
    const bear = card({ typeLine: 'Creature — Bear', power: '2', toughness: '2' });
    expect(compareCards(bear, card({ typeLine: 'Creature — Bear', power: '3', toughness: '2' }))).toContainEqual({
      key: 'body',
      tone: 'better',
      direction: 'up',
      label: 'Body',
      detail: '3/2 body',
    });
    expect(compareCards(bear, card({ typeLine: 'Creature — Wall', power: '0', toughness: '4' })).map((m) => m.key)).not.toContain('body');
    expect(compareCards(bear, card({ typeLine: 'Creature — Lhurgoyf', power: '*', toughness: '1+*' })).map((m) => m.key)).not.toContain('body');
  });

  it('leaves out small gaps and anything a card lacks, and never compares cost or speed with a land', () => {
    const out = card({ inclusionRate: 0.3 });
    expect(compareCards(out, card({ inclusionRate: 0.32 }))).toEqual([]);
    expect(compareCards(out, card({ inclusionRate: null }))).toEqual([]);
    expect(compareCards(card({ typeLine: 'Land', manaValue: 0 }), card({ typeLine: 'Instant', manaValue: 2 }))).toEqual([]);
  });

  it('reads lower play as rarely played', () => {
    expect(compareCards(card({ inclusionRate: 0.4 }), card({ inclusionRate: 0.1 }))).toEqual([
      { key: 'play', tone: 'worse', direction: 'down', label: 'Rarely played', detail: 'rarely played with this commander' },
    ]);
  });
});
