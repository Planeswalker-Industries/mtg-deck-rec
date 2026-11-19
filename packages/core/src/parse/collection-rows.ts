import type { CollectionRowInput } from '../contract';
import {
  MAX_CARD_COPIES,
  MAX_COLLECTION_NAME_CHARS,
  MAX_COLLECTION_SET_CODE_CHARS,
  MAX_COLLECTOR_NUMBER_CHARS,
  MAX_CONDITION_CHARS,
  MAX_LANG_CHARS,
  MAX_SCRYFALL_ID_CHARS,
} from '../contract/schemas';

/** How much of a file to sample for binary content: enough to cover a CSV header and its first rows. */
const BINARY_SAMPLE_CHARS = 4096;
/** Share of control characters above which a sample is binary: a text export has next to none. */
const BINARY_CONTROL_FRACTION = 0.1;

/** The optional string hints a row can drop and still be matched by its other fields, with each one's cap. */
const HINT_CAPS = [
  ['setCode', MAX_COLLECTION_SET_CODE_CHARS],
  ['collectorNumber', MAX_COLLECTOR_NUMBER_CHARS],
  ['lang', MAX_LANG_CHARS],
  ['condition', MAX_CONDITION_CHARS],
  ['scryfallId', MAX_SCRYFALL_ID_CHARS],
] as const satisfies readonly (readonly [keyof CollectionRowInput, number])[];

/**
 * Splits parsed collection rows into those the resolve schema accepts and those it would refuse, so one bad line
 * never fails a whole batch. A row with too many copies or an over-long name is skipped (its `rowNo` is returned);
 * a kept row loses any hint over its cap (or a TCGplayer id too large to be an exact integer) and keeps the rest.
 */
export function splitCollectionRows(rows: CollectionRowInput[]): { rows: CollectionRowInput[]; skipped: number[] } {
  const kept: CollectionRowInput[] = [];
  const skipped: number[] = [];
  for (const row of rows) {
    if (row.quantity > MAX_CARD_COPIES || (row.name?.length ?? 0) > MAX_COLLECTION_NAME_CHARS) {
      skipped.push(row.rowNo);
      continue;
    }
    let out = row;
    for (const [field, cap] of HINT_CAPS) {
      const value = row[field];
      if (value !== undefined && value.length > cap) {
        if (out === row) out = { ...row };
        delete out[field];
      }
    }
    // The schema takes only safe integers; a 20-digit id in a TCGplayer export would fail the whole batch.
    if (out.tcgplayerId !== undefined && !Number.isSafeInteger(out.tcgplayerId)) {
      if (out === row) out = { ...row };
      delete out.tcgplayerId;
    }
    kept.push(out);
  }
  return { rows: kept, skipped };
}

/** True when a file's text looks binary (a spreadsheet or image picked by mistake): a NUL, or many control characters. */
export function looksLikeBinary(text: string): boolean {
  const sample = text.slice(0, BINARY_SAMPLE_CHARS);
  let control = 0;
  for (const ch of sample) {
    if (ch === '\0') return true;
    // Below the space or DEL; tab, LF and CR are ordinary in text exports.
    if ((ch < ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') || ch === '\x7f') control++;
  }
  return sample.length > 0 && control / sample.length > BINARY_CONTROL_FRACTION;
}
