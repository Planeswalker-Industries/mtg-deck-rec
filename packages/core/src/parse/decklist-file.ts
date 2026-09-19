import { isKnownCollectionHeader, parseCollectionCsv } from './collection-csv';
import { looksLikeCsv } from './csv';

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
 * **Text** is already a decklist and is returned untouched, so its sections, its commander block and its own
 * formatting survive to the decklist parser.
 */
export function decklistFromFile(text: string): string {
  if (!looksLikeCsv(text, isKnownCollectionHeader)) return text;

  const byName = new Map<string, number>();
  for (const row of parseCollectionCsv(text)) {
    if (!row.name) continue;
    byName.set(row.name, (byName.get(row.name) ?? 0) + row.quantity);
  }
  return [...byName].map(([name, quantity]) => `${quantity} ${name}`).join('\n');
}
