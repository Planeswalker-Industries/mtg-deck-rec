/** One card of a deck being exported. A deck is oracle-level, so the printing fields are optional hints. */
export interface DeckExportEntry {
  name: string;
  quantity: number;
  commander: boolean;
  /** The printing the site shows for the card, when known. Import tools use it to pick the same art. */
  setCode?: string;
  collectorNumber?: string;
}

/** Board values in the CSV's Board column. `decklistFromFile` reads the same words back. */
export const EXPORT_BOARD = { commander: 'commander', main: 'mainboard' } as const;

/** The CSV's header row, in column order. Every name is one `parseCollectionCsv` already recognises, plus Board. */
const CSV_HEADER = ['Quantity', 'Name', 'Set code', 'Collector number', 'Board'] as const;

const byName = (a: DeckExportEntry, b: DeckExportEntry) => a.name.localeCompare(b.name);

/** Commanders first, then the rest, each alphabetical, so an export reads the same every time. */
function ordered(entries: readonly DeckExportEntry[]): DeckExportEntry[] {
  return [...entries.filter((e) => e.commander).sort(byName), ...entries.filter((e) => !e.commander).sort(byName)];
}

/**
 * A deck as decklist text: a `Commander` block, a blank line, then a `Deck` block, one `quantity name` per line.
 *
 * The same shape the deck tool reopens a saved deck in, and one Moxfield, Archidekt and ManaBox all accept on paste,
 * so an export can be pasted straight back into any of them. Names only: set codes in text would give every
 * importer's name matching more ways to fail.
 */
export function decklistText(entries: readonly DeckExportEntry[]): string {
  const lines = (commander: boolean) =>
    ordered(entries)
      .filter((e) => e.commander === commander)
      .map((e) => `${e.quantity} ${e.name}`);
  return ['Commander', ...lines(true), '', 'Deck', ...lines(false), ''].join('\n');
}

/**
 * Quotes a CSV field when it has to be: card names carry commas ("Page, Loose Leaf") and quotes.
 *
 * No spreadsheet-formula escaping (a leading `'`): every value here is a catalog card name or a Scryfall set code,
 * never user-written text, and escaping would corrupt a real name like "+2 Mace" on the way back in.
 */
export function csvField(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A deck as CSV: quantity, name, the printing the site shows, and which board the card is on.
 *
 * Headers are ones the app's own CSV import recognises, so an export re-imports as the same deck with its commander
 * intact. Lines end in CRLF, as RFC 4180 asks and spreadsheet apps expect.
 */
export function decklistCsv(entries: readonly DeckExportEntry[]): string {
  const rows = ordered(entries).map((e) => [
    String(e.quantity),
    e.name,
    e.setCode ?? '',
    e.collectorNumber ?? '',
    e.commander ? EXPORT_BOARD.commander : EXPORT_BOARD.main,
  ]);
  return [[...CSV_HEADER], ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
