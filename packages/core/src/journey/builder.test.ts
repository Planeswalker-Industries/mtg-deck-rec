import { describe, expect, it } from 'vitest';
import type { CardId, DeckInput } from '../contract';
import { addCard, canAdd, copiesOf, isBasicLand, makeCommander, removeCard, setQuantity, swapCard } from './builder';

const card = (id: number, typeLine = 'Creature — Bear') => ({ id: id as CardId, typeLine });
const plains = card(50, 'Basic Land — Plains');
const snowForest = card(51, 'Basic Snow Land — Forest');
const LIESA = 1 as CardId;

const deck: DeckInput = {
  commanders: [LIESA],
  cards: [
    { cardId: LIESA, quantity: 1, section: 'commander' },
    { cardId: 2 as CardId, quantity: 1, section: 'main' },
    { cardId: plains.id, quantity: 10, section: 'main' },
  ],
};

describe('deckbuilder edits', () => {
  it('knows basic lands, snow ones included, and nothing else', () => {
    expect(isBasicLand(plains)).toBe(true);
    expect(isBasicLand(snowForest)).toBe(true);
    expect(isBasicLand(card(3, 'Land'))).toBe(false);
    expect(isBasicLand(card(4, 'Legendary Land'))).toBe(false);
  });

  it('adds a card once, but basic lands as often as wanted', () => {
    const once = addCard(deck, card(3));
    expect(copiesOf(once, 3 as CardId)).toBe(1);
    expect(addCard(once, card(3))).toBe(once);
    expect(canAdd(deck, card(2))).toBe(false);
    expect(canAdd(deck, card(LIESA))).toBe(false);
    expect(copiesOf(addCard(deck, plains), plains.id)).toBe(11);
  });

  it('sets quantities within the singleton rule, and 0 takes a card out', () => {
    expect(copiesOf(setQuantity(deck, plains, 7), plains.id)).toBe(7);
    expect(copiesOf(setQuantity(deck, card(2), 3), 2 as CardId)).toBe(1);
    expect(copiesOf(setQuantity(deck, card(2), 0), 2 as CardId)).toBe(0);
  });

  it('removes a commander from both places it is kept', () => {
    const next = removeCard(deck, LIESA);
    expect(next.commanders).toEqual([]);
    expect(next.cards.some((c) => c.cardId === LIESA)).toBe(false);
  });

  it('replacing the commander sends the old one to the main deck; a partner joins it', () => {
    const replaced = makeCommander(deck, card(2), 'replace');
    expect(replaced.commanders).toEqual([2]);
    expect(replaced.cards).toContainEqual({ cardId: 2, quantity: 1, section: 'commander' });
    expect(replaced.cards).toContainEqual({ cardId: LIESA, quantity: 1, section: 'main' });
    expect(replaced.cards.some((c) => c.cardId === 2 && c.section === 'main')).toBe(false);

    const paired = makeCommander(deck, card(9), 'partner');
    expect(paired.commanders).toEqual([LIESA, 9]);
    expect(makeCommander(paired, card(10), 'partner')).toBe(paired);
  });

  it('swaps one copy of a card for another, refusing a replacement already in the deck', () => {
    const swapped = swapCard(deck, card(2), card(7));
    expect(copiesOf(swapped, 2 as CardId)).toBe(0);
    expect(copiesOf(swapped, 7 as CardId)).toBe(1);
    expect(swapCard(deck, card(2), card(LIESA))).toBe(deck);
    expect(copiesOf(swapCard(deck, plains, card(8)), plains.id)).toBe(9);
  });
});
