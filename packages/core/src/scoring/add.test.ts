import { describe, expect, it } from 'vitest';
import { ADD_WEIGHTS, cardCategory, roleGap, roleShortfalls } from './add';
import { blendScore } from './swap';

describe('cardCategory', () => {
  it('files multi-type cards by precedence and reads only the front face and card types', () => {
    expect(cardCategory('Artifact Creature — Golem')).toBe('creature');
    expect(cardCategory('Land Creature — Forest Dryad')).toBe('creature');
    expect(cardCategory('Legendary Planeswalker — Jace')).toBe('planeswalker');
    expect(cardCategory('Kindred Instant — Goblin')).toBe('instant');
    expect(cardCategory('Creature — Human Sorcerer')).toBe('creature');
    expect(cardCategory('Sorcery // Land')).toBe('sorcery');
    expect(cardCategory('Enchantment — Aura')).toBe('enchantment');
    expect(cardCategory('Legendary Land')).toBe('land');
  });
});

describe('roleShortfalls and roleGap', () => {
  const targets = [
    { roleId: 'ramp', label: 'Ramp', target: 10 },
    { roleId: 'removal', label: 'Removal', target: 8 },
    { roleId: 'draw', label: 'Card advantage', target: 10 },
  ];
  const counts = new Map([
    ['ramp', 12],
    ['removal', 2],
    ['draw', 5],
  ]);

  it('measures how far below target each role is', () => {
    const shortfalls = roleShortfalls(counts, targets);
    expect(shortfalls.get('ramp')).toBe(0);
    expect(shortfalls.get('removal')).toBeCloseTo(0.75);
    expect(shortfalls.get('draw')).toBeCloseTo(0.5);
  });

  it('scores a card by its most needed role and lists only roles the deck is short on', () => {
    const shortfalls = roleShortfalls(counts, targets);
    expect(roleGap(['ramp', 'draw', 'removal'], shortfalls)).toEqual({ gap: 0.75, roleIds: ['removal', 'draw'] });
    expect(roleGap(['ramp'], shortfalls)).toEqual({ gap: 0, roleIds: [] });
  });

  it('ranks a card that fills a short role above an equally played card that does not', () => {
    const fills = blendScore({ tag: null, manaValue: null, staple: null, corpus: 0.6, votes: null, role: 0.75 }, ADD_WEIGHTS);
    const doesNot = blendScore({ tag: null, manaValue: null, staple: null, corpus: 0.6, votes: null, role: 0 }, ADD_WEIGHTS);
    expect(fills.total).toBeGreaterThan(doesNot.total);
    expect(fills.effectiveWeights.corpus).toBeCloseTo(0.7);
  });
});
