import { describe, expect, it } from 'vitest';
import type { CardId, CardSummary, DeckInput } from '../contract';
import type { StatLine } from './deck-tally';
import { cutsNeeded, journeyReducer, openSlots, startJourney, type JourneyAction } from './journey';
import { basicToSwap, fitsLandSwap, landSwapMode } from './land-swap';

const card = (id: number, name: string, typeLine: string): CardSummary =>
  ({ id: id as CardId, name, typeLine, manaValue: 0, keywords: [] }) as unknown as CardSummary;

const line = (key: string, value: number, target: number): StatLine => ({
  key,
  group: 'mana',
  label: key,
  value,
  target,
  ok: false,
  start: value,
});

const SWAMP = card(10, 'Swamp', 'Basic Land — Swamp');
const ISLAND = card(11, 'Island', 'Basic Land — Island');
const SPELL = card(12, 'Sign in Blood', 'Sorcery');
const COMMANDER = 1 as CardId;
const deck: DeckInput = {
  commanders: [COMMANDER],
  cards: [
    { cardId: SWAMP.id, quantity: 26, section: 'main' },
    { cardId: ISLAND.id, quantity: 3, section: 'main' },
    ...Array.from({ length: 70 }, (_, i) => ({ cardId: (100 + i) as CardId, quantity: 1, section: 'main' as const })),
  ],
};
const cards = new Map<CardId, CardSummary>([SWAMP, ISLAND, SPELL].map((c) => [c.id, c]));

describe('landSwapMode', () => {
  it('trades basics for spells when the deck runs too many lands', () => {
    expect(landSwapMode([line('lands', 33, 29), line('basicLands', 20, 20)])).toBe('spells');
    expect(landSwapMode([line('lands', 33, 29), line('basicLands', 26, 20)])).toBe('spells');
  });

  it('trades basics for nonbasic lands when only the basics are over', () => {
    expect(landSwapMode([line('lands', 29, 29), line('basicLands', 26, 20)])).toBe('lands');
  });

  it('needs none when both are on target, counting the target as Deck stats rounds it', () => {
    expect(landSwapMode([line('lands', 29, 28.99), line('basicLands', 20, 19.72)])).toBeNull();
    expect(landSwapMode([])).toBeNull();
  });
});

describe('fitsLandSwap', () => {
  it('takes spells for spells, nonbasic lands for lands', () => {
    expect(fitsLandSwap('spells', SPELL)).toBe(true);
    expect(fitsLandSwap('spells', card(13, 'Bojuka Bog', 'Land'))).toBe(false);
    expect(fitsLandSwap('lands', card(13, 'Bojuka Bog', 'Land'))).toBe(true);
    expect(fitsLandSwap('lands', SWAMP)).toBe(false);
    expect(fitsLandSwap('lands', SPELL)).toBe(false);
  });
});

describe('basicToSwap', () => {
  it('picks the basic with the most copies, and none once every basic is gone', () => {
    const state = startJourney(deck);
    expect(basicToSwap(state, cards)?.name).toBe('Swamp');
    const noBasics = startJourney({ ...deck, cards: deck.cards.filter((c) => c.cardId !== SWAMP.id && c.cardId !== ISLAND.id) });
    expect(basicToSwap(noBasics, cards)).toBeNull();
  });

  it('breaks a tie by name', () => {
    const tied = startJourney({ ...deck, cards: deck.cards.map((c) => (c.cardId === SWAMP.id ? { ...c, quantity: 3 } : c)) });
    expect(basicToSwap(tied, cards)?.name).toBe('Island');
  });

  it('a cut basic and an added spell leave the deck at 100', () => {
    const swap: JourneyAction[] = [{ type: 'cut', card: SWAMP }, { type: 'add', card: SPELL }];
    const state = swap.reduce(journeyReducer, startJourney(deck));
    expect(cutsNeeded(state)).toBe(0);
    expect(openSlots(state)).toBe(0);
  });
});
