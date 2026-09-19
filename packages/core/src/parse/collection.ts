import type { CollectionRowInput } from '../contract';
import { isKnownCollectionHeader, parseCollectionCsv } from './collection-csv';
import { looksLikeCsv } from './csv';
import { parseDecklist } from './decklist';

/**
 * Collection rows from a pasted or uploaded export, in either shape the collection apps offer.
 *
 * **CSV** ("Name,Set code,...,Scryfall ID,...") is recognised by its header row and read by `parseCollectionCsv`,
 * which carries the Scryfall id through — the most exact key `resolve_collection_rows` has.
 *
 * **Text** ("4 Sol Ring (C21) 263 *F*") is the same format the apps use for deck exports, so it goes through the
 * decklist parser. Every section counts: a sideboard or maybeboard card is still a card the user owns.
 */
export function parseCollectionText(text: string): CollectionRowInput[] {
  if (looksLikeCsv(text, isKnownCollectionHeader)) return parseCollectionCsv(text);

  return parseDecklist(text).lines.map((line) => {
    const row: CollectionRowInput = { rowNo: line.lineNo, name: line.name, quantity: line.quantity };
    if (line.setCode) row.setCode = line.setCode;
    if (line.collectorNumber) row.collectorNumber = line.collectorNumber;
    if (line.finish) row.finish = line.finish;
    return row;
  });
}
