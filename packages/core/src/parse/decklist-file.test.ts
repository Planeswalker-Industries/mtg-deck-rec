import { describe, expect, it } from 'vitest';
import { decklistFromFile } from './decklist-file';

describe('decklistFromFile', () => {
  it('collapses a CSV export to quantity and name', () => {
    const csv = 'Name,Set code,Collector number,Foil,Quantity,Scryfall ID\nSol Ring,C21,263,normal,1,\n"Page, Loose Leaf",SOS,250,normal,2,\n';
    expect(decklistFromFile(csv)).toBe('1 Sol Ring\n2 Page, Loose Leaf');
  });

  it('adds copies of the same card that arrived on separate rows', () => {
    const csv = 'Name,Set code,Foil,Quantity\nSol Ring,C21,foil,1\nSol Ring,LTC,normal,2\n';
    expect(decklistFromFile(csv)).toBe('3 Sol Ring');
  });

  it('leaves a text decklist alone, so its sections survive', () => {
    const text = 'Commander\n1 Liesa, Forgotten Archangel\n\nDeck\n1 Sol Ring (C21) 263';
    expect(decklistFromFile(text)).toBe(text);
  });
});
