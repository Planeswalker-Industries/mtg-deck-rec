import type { CollectionRowInput } from '../contract';
import { parseDecklist } from './decklist';

/**
 * Collection rows from pasted text exports ("4 Sol Ring (C21) 263 *F*"), which the collection apps share with deck
 * exports. Every section counts: a sideboard or maybeboard card is still a card the user owns.
 */
export function parseCollectionText(text: string): CollectionRowInput[] {
  return parseDecklist(text).lines.map((line) => {
    const row: CollectionRowInput = { rowNo: line.lineNo, name: line.name, quantity: line.quantity };
    if (line.setCode) row.setCode = line.setCode;
    if (line.collectorNumber) row.collectorNumber = line.collectorNumber;
    if (line.finish) row.finish = line.finish;
    return row;
  });
}
