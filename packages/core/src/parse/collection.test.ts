import { describe, expect, it } from 'vitest';
import { parseCollectionText } from './collection';

describe('parseCollectionText', () => {
  it('reads quantity, name, set, collector number and finish', () => {
    expect(parseCollectionText('4 Sol Ring (C21) 263 *F*\n1x Lightning Bolt (2XM) 123\nCounterspell')).toEqual([
      { rowNo: 1, name: 'Sol Ring', quantity: 4, setCode: 'C21', collectorNumber: '263', finish: 'foil' },
      { rowNo: 2, name: 'Lightning Bolt', quantity: 1, setCode: '2XM', collectorNumber: '123' },
      { rowNo: 3, name: 'Counterspell', quantity: 1 },
    ]);
  });

  it('keeps cards from every section, skips headers and blank lines', () => {
    const rows = parseCollectionText('Commander\n1 Liesa, Forgotten Archangel\n\nDeck\n2 Swords to Plowshares\n\nSideboard\n1 Fumigate *E*');
    expect(rows.map((r) => [r.name, r.quantity, r.finish])).toEqual([
      ['Liesa, Forgotten Archangel', 1, undefined],
      ['Swords to Plowshares', 2, undefined],
      ['Fumigate', 1, 'etched'],
    ]);
  });

  it('drops export decorations like categories and tags', () => {
    expect(parseCollectionText('1 Sol Ring (C21) 263 [Ramp] #!artifact')).toEqual([
      { rowNo: 1, name: 'Sol Ring', quantity: 1, setCode: 'C21', collectorNumber: '263' },
    ]);
  });
});
