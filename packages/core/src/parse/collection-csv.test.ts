import { describe, expect, it } from 'vitest';
import { parseCollectionCsv } from './collection-csv';
import { parseCollectionText } from './collection';

const MANABOX =
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Added\n' +
  'Goblin Glasswright // Craft with Pride,SOS,Secrets of Strixhaven,117,foil,common,1,112687,c85c5f06-dd31-4e2c-97be-2f64d65069ea,0.28,false,false,near_mint,en,USD,2026-08-12T01:13:03.435Z\n' +
  '"Page, Loose Leaf",SOS,Secrets of Strixhaven,250,normal,common,1,112642,8c6fecfd-8241-4cf0-b1eb-19472b99e0ed,0.24,false,false,near_mint,en,USD,2026-08-12T01:13:03.512Z\n' +
  'Elemental Mascot,SOS,Secrets of Strixhaven,185,normal,common,3,111741,c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0,0.13,false,false,near_mint,en,USD,2026-08-12T01:13:03.444Z\n';

describe('parseCollectionCsv', () => {
  it('reads a ManaBox export, keeping the Scryfall id', () => {
    expect(parseCollectionCsv(MANABOX)).toEqual([
      {
        rowNo: 1,
        quantity: 1,
        name: 'Goblin Glasswright // Craft with Pride',
        scryfallId: 'c85c5f06-dd31-4e2c-97be-2f64d65069ea',
        setCode: 'SOS',
        collectorNumber: '117',
        finish: 'foil',
        lang: 'en',
        condition: 'near_mint',
      },
      {
        rowNo: 2,
        quantity: 1,
        name: 'Page, Loose Leaf',
        scryfallId: '8c6fecfd-8241-4cf0-b1eb-19472b99e0ed',
        setCode: 'SOS',
        collectorNumber: '250',
        lang: 'en',
        condition: 'near_mint',
      },
      {
        rowNo: 3,
        quantity: 3,
        name: 'Elemental Mascot',
        scryfallId: 'c507eb1c-48e9-4d28-bb2d-71f2a9df9ab0',
        setCode: 'SOS',
        collectorNumber: '185',
        lang: 'en',
        condition: 'near_mint',
      },
    ]);
  });

  it('reads Moxfield column names', () => {
    const rows = parseCollectionCsv(
      'Count,Name,Edition,Condition,Language,Foil,Collector Number\n2,Sol Ring,C21,Near Mint,English,foil,263\n',
    );
    expect(rows).toEqual([
      {
        rowNo: 1,
        quantity: 2,
        name: 'Sol Ring',
        setCode: 'C21',
        collectorNumber: '263',
        finish: 'foil',
        condition: 'Near Mint',
      },
    ]);
  });

  it('reads Archidekt column names, including an etched finish', () => {
    const rows = parseCollectionCsv(
      'Quantity,Name,Finish,Condition,Language,Edition Name,Edition Code,Scryfall ID,Collector Number\n' +
        '1,Wrath of God,Etched,NM,en,Double Masters 2022,2X2,aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,12\n',
    );
    expect(rows[0]).toMatchObject({ name: 'Wrath of God', finish: 'etched', setCode: '2X2', collectorNumber: '12' });
  });

  it('reads TCGplayer column names and prefers Simple Name over Product Name', () => {
    const rows = parseCollectionCsv(
      'Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Product ID\n' +
        '3,Sol Ring (Foil),Sol Ring,Commander 2021,263,C21,Foil,Near Mint,123456\n',
    );
    expect(rows[0]).toMatchObject({ name: 'Sol Ring', quantity: 3, setCode: 'C21', collectorNumber: '263', finish: 'foil', tcgplayerId: 123456 });
  });

  it('treats unreadable hints as absent rather than failing the row', () => {
    const rows = parseCollectionCsv(
      'Name,Quantity,Set code,Scryfall ID,Foil,Language,Collector number\n' +
        'Sol Ring,,Secrets of Strixhaven,not-a-uuid,sparkly,Englishe,263.0\n',
    );
    // The set name, the bad id, the unknown finish and the too-long language are all dropped; the card survives.
    expect(rows).toEqual([{ rowNo: 1, quantity: 1, name: 'Sol Ring', collectorNumber: '263' }]);
  });

  it('ignores columns it does not know', () => {
    const rows = parseCollectionCsv('Name,Quantity,Purchase price,Tags,Added\nSol Ring,2,4.20,ramp,2026-01-01\n');
    expect(rows).toEqual([{ rowNo: 1, quantity: 2, name: 'Sol Ring' }]);
  });

  it('skips rows with nothing to match on', () => {
    expect(parseCollectionCsv('Name,Quantity\n,3\nSol Ring,1\n')).toEqual([{ rowNo: 2, quantity: 1, name: 'Sol Ring' }]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCollectionCsv('')).toEqual([]);
  });
});

describe('parseCollectionText routing', () => {
  it('sends a CSV export to the CSV parser', () => {
    expect(parseCollectionText(MANABOX)[0]).toMatchObject({ scryfallId: 'c85c5f06-dd31-4e2c-97be-2f64d65069ea' });
  });

  it('still reads the text export, which is what the apps share with deck exports', () => {
    expect(parseCollectionText('1 Goblin Glasswright // Craft with Pride (SOS) 117 *F*')).toEqual([
      { rowNo: 1, name: 'Goblin Glasswright // Craft with Pride', quantity: 1, setCode: 'SOS', collectorNumber: '117', finish: 'foil' },
    ]);
  });
});
