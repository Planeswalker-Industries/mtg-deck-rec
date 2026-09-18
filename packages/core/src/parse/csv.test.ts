import { describe, expect, it } from 'vitest';
import { looksLikeCsv, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields, which real card names have', () => {
    expect(parseCsv('Name,Set\n"Page, Loose Leaf",SOS\n"Silverquill, the Disputant",SOS')).toEqual([
      ['Name', 'Set'],
      ['Page, Loose Leaf', 'SOS'],
      ['Silverquill, the Disputant', 'SOS'],
    ]);
  });

  it('unescapes doubled quotes and keeps newlines inside a quoted field', () => {
    expect(parseCsv('a,b\n"say ""hi""","two\nlines"')).toEqual([
      ['a', 'b'],
      ['say "hi"', 'two\nlines'],
    ]);
  });

  it('treats a mid-field quote as literal', () => {
    expect(parseCsv('a\n5" binder')).toEqual([['a'], ['5" binder']]);
  });

  it('ignores a BOM, CRLF line endings and a trailing newline', () => {
    expect(parseCsv('﻿Name,Qty\r\nSol Ring,4\r\n')).toEqual([
      ['Name', 'Qty'],
      ['Sol Ring', '4'],
    ]);
  });

  it('keeps empty fields, so column positions do not shift', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('looksLikeCsv', () => {
  const known = (f: string) => ['name', 'quantity', 'set code'].includes(f.trim().toLowerCase());

  it('recognises a header row', () => {
    expect(looksLikeCsv('Name,Set code,Quantity\nSol Ring,C21,4', known)).toBe(true);
  });

  it('does not mistake a decklist for a CSV, even with a comma in a card name', () => {
    expect(looksLikeCsv('1 Page, Loose Leaf (SOS) 250\n1 Sol Ring (C21) 263', known)).toBe(false);
  });

  it('needs more than one known column, since a card can be called Name', () => {
    expect(looksLikeCsv('Name,Whatever\nSol Ring,x', known)).toBe(false);
  });
});
