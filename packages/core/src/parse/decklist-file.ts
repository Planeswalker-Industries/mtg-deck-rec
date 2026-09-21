import { isKnownCollectionHeader, parseCollectionCsv } from './collection-csv';
import { parseCsv, looksLikeCsv } from './csv';
import { EXPORT_BOARD } from './decklist-export';

/** Header names for the column saying which board a card is on. Our own export writes "Board". */
const BOARD_HEADERS: readonly string[] = ['board', 'section'];

/**
 * Which data rows (numbered from 1, like `CollectionRowInput.rowNo`) a Board column marks as the commander.
 * Empty when the CSV has no such column, which is every third-party export we know of.
 */
function commanderRows(text: string): Set<number> {
  const [header, ...rows] = parseCsv(text);
  const at = header?.findIndex((field) => BOARD_HEADERS.includes(field.trim().toLowerCase())) ?? -1;
  const out = new Set<number>();
  if (at < 0) return out;
  rows.forEach((row, index) => {
    if (row[at]?.trim().toLowerCase() === EXPORT_BOARD.commander) out.add(index + 1);
  });
  return out;
}

/**
 * Decklist text from an uploaded export, whichever shape it came in.
 *
 * A **CSV** deck export is collapsed to `quantity name` lines, because a deck is oracle-level: which printing of
 * Sol Ring it is changes nothing about the recommendations, and carrying set codes through would only give the name
 * resolver more ways to fail. This is the one place the "just quantity and name" rule is exactly right.
 *
 * Copies of the same card on separate rows — foil and non-foil, two printings — are added together, since a deck
 * cares how many it runs, not which ones they are.
 *
 * When a Board column marks commanders (the app's own export does), they come out as a `Commander` block ahead of
 * a `Deck` block, so a deck exported here re-imports with its commander intact.
 *
 * **Text** is already a decklist and is returned untouched, so its sections, its commander block and its own
 * formatting survive to the decklist parser.
 */
export function decklistFromFile(text: string): string {
  if (!looksLikeCsv(text, isKnownCollectionHeader)) return text;

  const commanders = commanderRows(text);
  const main = new Map<string, number>();
  const command = new Map<string, number>();
  for (const row of parseCollectionCsv(text)) {
    if (!row.name) continue;
    const into = commanders.has(row.rowNo) ? command : main;
    into.set(row.name, (into.get(row.name) ?? 0) + row.quantity);
  }
  const lines = (cards: Map<string, number>) => [...cards].map(([name, quantity]) => `${quantity} ${name}`);
  if (command.size === 0) return lines(main).join('\n');
  return ['Commander', ...lines(command), '', 'Deck', ...lines(main)].join('\n');
}
