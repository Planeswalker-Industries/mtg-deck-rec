/**
 * A small RFC 4180 CSV reader, because collection exports carry card names with commas in them.
 *
 * "Page, Loose Leaf" and "Silverquill, the Disputant" are real cards, and a naive split on commas turns both into
 * two broken fields. Quoted fields, doubled quotes inside them (`""`) and newlines inside quotes are all handled.
 *
 * Deliberately not a dependency: the rules fit in a page, this runs on user files in the browser, and a parser we
 * own is a parser we can fix when an export surprises us.
 */

/** Splits CSV text into rows of fields. Rows keep their fields verbatim, trimmed of surrounding whitespace. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let sawField = false;

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of the first header's name.
  const src = text.replace(/^﻿/, '');

  const endField = () => {
    row.push(field.trim());
    field = '';
    sawField = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline must not produce a row of one empty field.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    // A quote only opens a quoted field at the start of one; mid-field quotes are literal (5" binder).
    if (ch === '"' && !sawField && field.trim() === '') {
      quoted = true;
      sawField = true;
      field = '';
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      endRow();
      continue;
    }
    field += ch;
    sawField = true;
  }

  // Whatever is left is a final row without a trailing newline.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Whether text looks like a CSV export rather than a decklist.
 *
 * Decided on the **header row**, not on commas: "Page, Loose Leaf" is a perfectly good decklist line, and a
 * collection export's first row always names its columns. Two or more known column names is the bar — one could be
 * a card called "Name".
 */
export function looksLikeCsv(text: string, knownHeader: (field: string) => boolean): boolean {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim() !== '');
  if (firstLine === undefined || !firstLine.includes(',')) return false;
  const fields = parseCsv(firstLine)[0] ?? [];
  return fields.filter(knownHeader).length >= 2;
}
