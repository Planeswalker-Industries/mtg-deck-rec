import { describe, expect, it } from 'vitest';
import { massEntryUrl, productUrl, searchUrl, splitIntoCarts, tcgplayerLink, trackingBase, type CartLine } from './tcgplayer';

const BASE = 'https://partner.tcgplayer.com/mtg-deck-app';

describe('trackingBase', () => {
  it.each([
    'https://partner.tcgplayer.com/mtg-deck-app',
    'https://partner.tcgplayer.com/KBNV3x',
    'https://partner.tcgplayer.com/c/123/456/789',
    'https://tcgplayer.pxf.io/c/123/456/789',
    'https://tcgplayer.pxf.io/c/123/456/789/',
  ])('accepts %s', (raw) => {
    expect(trackingBase(raw)).toBe(raw);
  });

  it('trims whitespace', () => {
    expect(trackingBase(`  ${BASE}\n`)).toBe(BASE);
  });

  it.each([
    'https://www.tcgplayer.com/?irclickid=abc&irpid=8124862',
    'https://partner.tcgplayer.com/mtg-deck-app?irclickid=abc',
    'https://partner.tcgplayer.com/',
    'https://partner.tcgplayer.com',
    'http://partner.tcgplayer.com/mtg-deck-app',
    'https://evil.example.com/mtg-deck-app',
    'https://tcgplayer.pxf.io/mtg-deck-app',
    'https://partner.tcgplayer.com/c/1/2',
    'https://partner.tcgplayer.com/a/b',
    'not a url',
    '',
  ])('rejects %s', (raw) => {
    expect(trackingBase(raw)).toBeNull();
  });

  it('rejects undefined and null', () => {
    expect(trackingBase(undefined)).toBeNull();
    expect(trackingBase(null)).toBeNull();
  });
});

describe('tcgplayerLink', () => {
  it('wraps the target in the tracking link', () => {
    expect(tcgplayerLink('https://www.tcgplayer.com/product/42', BASE)).toBe(`${BASE}?u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F42`);
  });

  it('passes the target through without a base', () => {
    expect(tcgplayerLink('https://www.tcgplayer.com/product/42', null)).toBe('https://www.tcgplayer.com/product/42');
  });
});

describe('productUrl and searchUrl', () => {
  it('builds a product page', () => {
    expect(productUrl(42)).toBe('https://www.tcgplayer.com/product/42');
  });

  it('builds an encoded Magic search', () => {
    const url = new URL(searchUrl("Urza's Saga"));
    expect(url.origin + url.pathname).toBe('https://www.tcgplayer.com/search/magic/product');
    expect(url.searchParams.get('q')).toBe("Urza's Saga");
    expect(url.searchParams.get('productLineName')).toBe('magic');
  });
});

describe('massEntryUrl', () => {
  const lines: CartLine[] = [
    { name: "Urza's Saga", quantity: 2 },
    { name: 'Fire // Ice', quantity: 1 },
    { name: 'Kenrith, the Returned King', quantity: 1 },
  ];

  it('massEntryUrl encodes split and punctuated names', () => {
    const url = new URL(massEntryUrl(lines));
    expect(url.origin + url.pathname).toBe('https://www.tcgplayer.com/massentry');
    expect(url.searchParams.get('productline')).toBe('Magic');
    expect(url.searchParams.get('c')).toBe("2 Urza's Saga||1 Fire // Ice||1 Kenrith, the Returned King");
  });

  it('survives the double encoding of the tracking link', () => {
    const target = massEntryUrl(lines);
    const wrapped = new URL(tcgplayerLink(target, BASE));
    expect(wrapped.searchParams.get('u')).toBe(target);
  });
});

describe('splitIntoCarts', () => {
  const hundred: CartLine[] = Array.from({ length: 100 }, (_, i) => ({ name: `Card Number ${i}`, quantity: 1 }));
  const linesOf = (cart: string): string[] => {
    const inner = new URL(new URL(cart).searchParams.get('u') ?? '');
    return (inner.searchParams.get('c') ?? '').split('||');
  };

  it('returns one cart when everything fits', () => {
    const carts = splitIntoCarts(hundred, BASE, 100_000);
    expect(carts).toEqual([tcgplayerLink(massEntryUrl(hundred), BASE)]);
  });

  it('splitIntoCarts keeps each URL under the limit', () => {
    const maxChars = 1500;
    const carts = splitIntoCarts(hundred, BASE, maxChars);
    expect(carts.length).toBeGreaterThanOrEqual(2);
    for (const cart of carts) expect(cart.length).toBeLessThanOrEqual(maxChars);
    expect(carts.flatMap(linesOf)).toEqual(hundred.map((l) => `1 ${l.name}`));
  });

  it('gives a line too long for the limit a cart of its own', () => {
    const long: CartLine = { name: 'X'.repeat(500), quantity: 1 };
    const carts = splitIntoCarts([hundred[0]!, long, hundred[1]!], BASE, 300);
    expect(carts.map(linesOf)).toEqual([['1 Card Number 0'], [`1 ${long.name}`], ['1 Card Number 1']]);
  });

  it('returns no carts for no lines', () => {
    expect(splitIntoCarts([], BASE, 8000)).toEqual([]);
  });
});
