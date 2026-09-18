import type { CollectionRowInput, Finish } from '../contract';
import { parseCsv } from './csv';

/**
 * The columns we take from a collection CSV, and every header name we've seen for each.
 *
 * Matched by **header name, not by app**: ManaBox, Moxfield, Archidekt and TCGplayer all export the same facts under
 * different labels, and an app we've never seen usually picks a label from this list too. Anything not listed here —
 * purchase price, rarity, tags, date added — is ignored rather than guessed at, so a new column can't break an import.
 *
 * **Order within a field is preference, not position.** An export can carry two columns we both recognise, and the
 * better one is not always the leftmost: TCGplayer writes `Name` as "Sol Ring (Foil)" and `Simple Name` as
 * "Sol Ring", and its `Set` is a set *name* while `Set Code` beside it is the code. So each field takes the first
 * name in its own list that the header has, whatever order the columns appear in.
 */
const COLUMNS = {
  scryfallId: ['scryfall id', 'scryfallid', 'scryfall_id'],
  tcgplayerId: ['product id', 'productid', 'tcgplayer id', 'tcgplayer product id'],
  quantity: ['quantity', 'count', 'qty', 'card count'],
  // "Simple Name" is TCGplayer's name without its set and finish suffix, so it beats that export's own "Name".
  name: ['simple name', 'card name', 'name', 'product name'],
  setCode: ['set code', 'setcode', 'edition code', 'edition', 'set'],
  collectorNumber: ['collector number', 'collectornumber', 'card number', 'number'],
  finish: ['foil', 'finish', 'printing', 'foiling'],
  lang: ['language', 'lang'],
  condition: ['condition'],
} as const;

type Column = keyof typeof COLUMNS;

const ALL_HEADERS: ReadonlySet<string> = new Set<string>(Object.values(COLUMNS).flat());

/** Whether a CSV header is one we know how to read. Used to tell a CSV export from a decklist. */
export const isKnownCollectionHeader = (field: string): boolean => ALL_HEADERS.has(field.trim().toLowerCase());

/**
 * Finish names differ per app: ManaBox writes `normal`/`foil`, TCGplayer writes `Normal`/`Foil`, Moxfield writes an
 * empty cell or `foil`, Archidekt writes `Normal`/`Foil`/`Etched`. Anything we don't recognise means non-foil,
 * because a wrong finish is a wrong printing and the row is better matched loosely than wrongly.
 */
function toFinish(value: string | undefined): Finish | undefined {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'normal' || v === 'nonfoil' || v === 'non-foil' || v === 'false' || v === 'no') return undefined;
  if (v.includes('etched')) return 'etched';
  if (v.includes('foil') || v === 'true' || v === 'yes') return 'foil';
  return undefined;
}

/** A collector number can arrive as `117`, `117a`, `★117` or, from a spreadsheet, `117.0`. */
const cleanCollectorNumber = (value: string): string => value.trim().replace(/\.0+$/, '');

const SCRYFALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collection rows from a CSV export.
 *
 * Every column beyond quantity and name is a **hint**: it is used when it is readable and dropped when it is not, so
 * a malformed set code or an unparseable finish can never cost the user a card. The richest key present wins later,
 * in `resolve_collection_rows` — a Scryfall id matches an exact printing, a name alone still finds the card.
 *
 * `rowNo` counts data rows from 1, so it lines up with what the user sees under the header.
 */
export function parseCollectionCsv(text: string): CollectionRowInput[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];

  // Which CSV column index holds each field we care about, by preference rather than by column position.
  const headerAt = new Map<string, number>();
  header.forEach((field, index) => {
    const name = field.trim().toLowerCase();
    if (!headerAt.has(name)) headerAt.set(name, index);
  });
  const at = {} as Record<Column, number | undefined>;
  for (const [column, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    at[column] = names.map((name) => headerAt.get(name)).find((index) => index !== undefined);
  }

  const cell = (row: string[], column: Column): string | undefined => {
    const index = at[column];
    if (index === undefined) return undefined;
    const value = row[index]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  const out: CollectionRowInput[] = [];
  rows.slice(1).forEach((row, index) => {
    const name = cell(row, 'name');
    const scryfallId = cell(row, 'scryfallId');
    // Without a name or an id there is nothing to match, so the row is not worth carrying.
    if (name === undefined && scryfallId === undefined) return;

    const quantity = Number.parseInt(cell(row, 'quantity') ?? '1', 10);
    const entry: CollectionRowInput = {
      rowNo: index + 1,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    };
    if (name !== undefined) entry.name = name;
    // A malformed id is dropped rather than sent: it would only ever fail to match.
    if (scryfallId !== undefined && SCRYFALL_ID.test(scryfallId)) entry.scryfallId = scryfallId;

    const tcgplayerId = Number.parseInt(cell(row, 'tcgplayerId') ?? '', 10);
    if (Number.isFinite(tcgplayerId) && tcgplayerId > 0) entry.tcgplayerId = tcgplayerId;

    const setCode = cell(row, 'setCode');
    // Some exports put the set's full name here ("Secrets of Strixhaven"); only a real code is usable.
    if (setCode !== undefined && /^[A-Za-z0-9]{2,6}$/.test(setCode)) entry.setCode = setCode.toUpperCase();

    const collectorNumber = cell(row, 'collectorNumber');
    if (collectorNumber !== undefined) entry.collectorNumber = cleanCollectorNumber(collectorNumber);

    const finish = toFinish(cell(row, 'finish'));
    if (finish !== undefined) entry.finish = finish;

    const lang = cell(row, 'lang');
    if (lang !== undefined && /^[A-Za-z-]{2,5}$/.test(lang)) entry.lang = lang.toLowerCase();

    const condition = cell(row, 'condition');
    if (condition !== undefined) entry.condition = condition;

    out.push(entry);
  });
  return out;
}
