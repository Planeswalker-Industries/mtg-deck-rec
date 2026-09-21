import { describe, expect, it } from 'vitest';
import { parseCollectionCsv } from './collection-csv';
import { parseDecklist } from './decklist';
import { csvField, decklistCsv, decklistText, type DeckExportEntry } from './decklist-export';
import { decklistFromFile } from './decklist-file';

const DECK: DeckExportEntry[] = [
  { name: 'Sol Ring', quantity: 1, commander: false, setCode: 'FRC', collectorNumber: '21' },
  { name: 'Liesa, Forgotten Archangel', quantity: 1, commander: true, setCode: 'MKC', collectorNumber: '3' },
  { name: 'Plains', quantity: 12, commander: false },
  { name: 'Page, Loose Leaf', quantity: 1, commander: false, setCode: 'SOS', collectorNumber: '250' },
];

describe('decklistText', () => {
  it('writes a Commander block then a Deck block, each alphabetical', () => {
    expect(decklistText(DECK)).toBe(
      'Commander\n1 Liesa, Forgotten Archangel\n\nDeck\n1 Page, Loose Leaf\n12 Plains\n1 Sol Ring\n',
    );
  });

  it('parses back to the same cards, with the commander in its section', () => {
    const { lines } = parseDecklist(decklistText(DECK));
    expect(lines.map((l) => [l.quantity, l.name, l.section])).toEqual([
      [1, 'Liesa, Forgotten Archangel', 'commander'],
      [1, 'Page, Loose Leaf', 'main'],
      [12, 'Plains', 'main'],
      [1, 'Sol Ring', 'main'],
    ]);
  });
});

describe('decklistCsv', () => {
  it('writes a header, commanders first, quoting names with commas', () => {
    expect(decklistCsv(DECK).split('\r\n')).toEqual([
      'Quantity,Name,Set code,Collector number,Board',
      '1,"Liesa, Forgotten Archangel",MKC,3,commander',
      '1,"Page, Loose Leaf",SOS,250,mainboard',
      '12,Plains,,,mainboard',
      '1,Sol Ring,FRC,21,mainboard',
      '',
    ]);
  });

  it('is read back by the collection CSV parser with its printings', () => {
    const rows = parseCollectionCsv(decklistCsv(DECK));
    expect(rows.find((r) => r.name === 'Sol Ring')).toMatchObject({ quantity: 1, setCode: 'FRC', collectorNumber: '21' });
    expect(rows.find((r) => r.name === 'Plains')).toMatchObject({ quantity: 12 });
  });

  it('re-imports as a deck with its commander intact', () => {
    expect(decklistFromFile(decklistCsv(DECK))).toBe(
      'Commander\n1 Liesa, Forgotten Archangel\n\nDeck\n1 Page, Loose Leaf\n12 Plains\n1 Sol Ring',
    );
  });
});

describe('csvField', () => {
  it.each([
    ['Sol Ring', 'Sol Ring'],
    ['Page, Loose Leaf', '"Page, Loose Leaf"'],
    ['Kongming, "Sleeping Dragon"', '"Kongming, ""Sleeping Dragon"""'],
    ['+2 Mace', '+2 Mace'],
  ])('%s', (value, expected) => {
    expect(csvField(value)).toBe(expected);
  });
});
