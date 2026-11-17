import { describe, expect, it } from 'vitest';
import type { PriceEstimate } from '../contract';
import { sortCards, type SortableCard } from './card-sort';

const AS_OF = '2026-11-16T00:00:00Z';
const usd = (amount: number): PriceEstimate => ({ usd: amount, finish: 'nonfoil', asOf: AS_OF, source: 'scryfall' });

const card = (name: string, over: Partial<SortableCard> = {}): SortableCard => ({
  name,
  manaValue: 2,
  colorIdentity: '',
  price: null,
  ...over,
});

const names = (cards: SortableCard[]) => cards.map((c) => c.name);
const same = (c: SortableCard) => c;

describe('sortCards', () => {
  it('sorts by name ignoring case', () => {
    const cards = [card('sol Ring'), card('Arcane Signet'), card('counterspell')];
    expect(names(sortCards(cards, 'name', same))).toEqual(['Arcane Signet', 'counterspell', 'sol Ring']);
  });

  it('sorts by cost then name', () => {
    const cards = [
      card('Cultivate', { manaValue: 3 }),
      card('Sol Ring', { manaValue: 1 }),
      card('Arcane Signet', { manaValue: 2 }),
      card('Arcane Denial', { manaValue: 2 }),
    ];
    expect(names(sortCards(cards, 'cost', same))).toEqual(['Sol Ring', 'Arcane Denial', 'Arcane Signet', 'Cultivate']);
  });

  it('color puts mono W before U before B before R before G', () => {
    const cards = [
      card('Forest Card', { colorIdentity: 'G' }),
      card('Mountain Card', { colorIdentity: 'R' }),
      card('Island Card', { colorIdentity: 'U' }),
      card('Swamp Card', { colorIdentity: 'B' }),
      card('Plains Card', { colorIdentity: 'W' }),
    ];
    expect(names(sortCards(cards, 'color', same))).toEqual(['Plains Card', 'Island Card', 'Swamp Card', 'Mountain Card', 'Forest Card']);
  });

  it('color puts two-colour cards in Multicolor after G', () => {
    const cards = [
      card('Azorius Card', { colorIdentity: 'WU' }),
      card('Green Card', { colorIdentity: 'G' }),
      card('White Card', { colorIdentity: 'W' }),
    ];
    expect(names(sortCards(cards, 'color', same))).toEqual(['White Card', 'Green Card', 'Azorius Card']);
  });

  it('color puts empty identity last as Colorless', () => {
    const cards = [card('Command Tower'), card('Golgari Card', { colorIdentity: 'BG' }), card('Red Card', { colorIdentity: 'R' })];
    expect(names(sortCards(cards, 'color', same))).toEqual(['Red Card', 'Golgari Card', 'Command Tower']);
  });

  it('color orders by mana value then name inside a bucket', () => {
    const cards = [
      card('Rhystic Study', { colorIdentity: 'U', manaValue: 3 }),
      card('Counterspell', { colorIdentity: 'U', manaValue: 2 }),
      card('Brainstorm', { colorIdentity: 'U', manaValue: 1 }),
      card('Arcane Denial', { colorIdentity: 'U', manaValue: 2 }),
    ];
    expect(names(sortCards(cards, 'color', same))).toEqual(['Brainstorm', 'Arcane Denial', 'Counterspell', 'Rhystic Study']);
  });

  it('price puts the highest first and ties by name', () => {
    const cards = [
      card('Sol Ring', { price: usd(1.5) }),
      card('Mana Crypt', { price: usd(150) }),
      card('Arcane Signet', { price: usd(1.5) }),
    ];
    expect(names(sortCards(cards, 'price', same))).toEqual(['Mana Crypt', 'Arcane Signet', 'Sol Ring']);
  });

  it('price puts unpriced cards last', () => {
    const cards = [
      card('Zed Preview'),
      card('Sol Ring', { price: usd(1.5) }),
      card('Alpha Preview'),
      card('Mana Crypt', { price: usd(150) }),
    ];
    expect(names(sortCards(cards, 'price', same))).toEqual(['Mana Crypt', 'Sol Ring', 'Alpha Preview', 'Zed Preview']);
  });

  it('does not mutate the input', () => {
    const cards = [card('Cultivate', { manaValue: 3 }), card('Sol Ring', { manaValue: 1 }), card('Arcane Signet', { manaValue: 2 })];
    const before = names(cards);
    const sorted = sortCards(cards, 'cost', same);
    expect(names(cards)).toEqual(before);
    expect(sorted).not.toBe(cards);
  });
});
