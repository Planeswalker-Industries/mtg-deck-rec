import { describe, expect, it } from 'vitest';
import { parseCollectionCsv } from './collection-csv';
import { appendCsvPage, archidektExportPage, collectionLink } from './collection-link';

describe('collectionLink', () => {
  it.each([
    ['https://archidekt.com/collection/v2/642535', 642535],
    ['https://archidekt.com/collection/v2/420247?collectionGame=1', 420247],
    ['https://www.archidekt.com/collection/v2/268710?collectionGame=1&page=2', 268710],
    ['  https://archidekt.com/collection/294835/  ', 294835],
    ['http://archidekt.com/collection/v2/755458#top', 755458],
  ])('reads the Archidekt collection id from %s', (url, collectionId) => {
    expect(collectionLink(url)).toEqual({ source: 'archidekt', collectionId });
  });

  it.each([
    ['https://manabox.app/binders/abc', 'manabox'],
    ['https://www.moxfield.com/collection/xyz', 'moxfield'],
    ['https://store.tcgplayer.com/collection/view/123', 'tcgplayer'],
  ])('recognises %s as %s without importing it', (url, source) => {
    expect(collectionLink(url)).toEqual({ source });
  });

  it.each([
    ['an Archidekt deck', 'https://archidekt.com/decks/123456'],
    ['another site', 'https://example.com/collection/v2/1'],
    ['a look-alike host', 'https://archidekt.com.evil.example/collection/v2/1'],
    ['a line of an export', '4 Sol Ring (C21) 263'],
    ['a link followed by more text', 'https://archidekt.com/collection/v2/1\n1 Sol Ring'],
    ['nothing', '   '],
  ])('ignores %s', (_what, text) => {
    expect(collectionLink(text)).toBeNull();
  });
});

describe('archidektExportPage', () => {
  it('reads the CSV, the row total and whether more follows', () => {
    expect(archidektExportPage({ content: 'Quantity,Name\r\n1,Sol Ring\r\n', totalRows: 4651, moreContent: true })).toEqual({
      csv: 'Quantity,Name\r\n1,Sol Ring\r\n',
      totalRows: 4651,
      more: true,
    });
  });

  it('treats a missing flag as the last page', () => {
    expect(archidektExportPage({ content: '' })).toEqual({ csv: '', totalRows: null, more: false });
  });

  it.each([null, 'text', { detail: 'Not found.' }, { content: 42 }])('rejects %j', (body) => {
    expect(archidektExportPage(body)).toBeNull();
  });
});

describe('appendCsvPage', () => {
  const HEADER = 'Quantity,Name,Finish,Condition,Language,Edition Code,Scryfall ID,Collector Number';
  const first = `${HEADER}\r\n1,Sol Ring,Normal,NM,EN,c21,a1b2c3d4-0000-4000-8000-000000000001,263\r\n`;
  const second = `${HEADER}\r\n2,"Page, Loose Leaf",Foil,NM,EN,sos,a1b2c3d4-0000-4000-8000-000000000002,250\r\n`;

  it('keeps the header once', () => {
    const joined = appendCsvPage(appendCsvPage('', first), second);
    expect(joined.split('\r\n').filter((line) => line === HEADER)).toHaveLength(1);
    expect(parseCollectionCsv(joined).map((r) => [r.name, r.quantity, r.finish ?? 'nonfoil'])).toEqual([
      ['Sol Ring', 1, 'nonfoil'],
      ['Page, Loose Leaf', 2, 'foil'],
    ]);
  });

  it('adds a line break when the first page lacks a trailing one', () => {
    expect(appendCsvPage(`${HEADER}\r\n1,Sol Ring`, `${HEADER}\r\n1,Arcane Signet`)).toBe(`${HEADER}\r\n1,Sol Ring\r\n1,Arcane Signet`);
  });

  it('keeps a page whole when it does not start with the same header', () => {
    expect(appendCsvPage(`${HEADER}\r\n1,Sol Ring\r\n`, '1,Arcane Signet\r\n')).toBe(`${HEADER}\r\n1,Sol Ring\r\n1,Arcane Signet\r\n`);
  });

  it('adds nothing for an empty page', () => {
    expect(appendCsvPage(first, `${HEADER}\r\n`)).toBe(first);
  });
});
