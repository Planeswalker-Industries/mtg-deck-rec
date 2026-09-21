import type { CardSummary } from "@mtg/core/contract";
import type { DeckExportEntry } from "@mtg/core/parse";
import type { DeckPageData } from "./deck-page";
import type { PublicClient } from "./supabase";

/**
 * Scryfall image URLs end in the printing's Scryfall id (`…/front/8/e/<uuid>.jpg?…`), which is `printings.id`. That
 * is how an oracle-level card finds the printing the site shows for it without a column of its own.
 */
const SCRYFALL_ID_IN_IMAGE_URL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z]+(?:\?|$)/i;

/** The Scryfall id of the printing whose image the site shows for a card, when it has one. */
export function shownPrintingId(card: CardSummary): string | null {
  const url = card.images?.front.normal;
  return url ? (SCRYFALL_ID_IN_IMAGE_URL.exec(url)?.[1]?.toLowerCase() ?? null) : null;
}

/** Every card of a deck page, commanders included, as export entries without printings. */
export function deckExportEntries(deck: DeckPageData): DeckExportEntry[] {
  return [
    ...deck.commanders.map((card) => ({ name: card.name, quantity: 1, commander: true })),
    ...deck.groups.flatMap((group) =>
      group.cards.map((entry) => ({ name: entry.card.name, quantity: entry.quantity, commander: false })),
    ),
  ];
}

/**
 * Export entries with the set code and collector number of each card's shown printing, so an importer picks the
 * same art the deck page shows. One query for the whole deck.
 *
 * A card whose printing can't be found (no image, or a printing outside the English paper set we keep) is exported
 * by name alone: set and number are hints to every importer, never required.
 */
export async function deckExportEntriesWithPrintings(db: PublicClient, deck: DeckPageData): Promise<DeckExportEntry[]> {
  const cards = [...deck.commanders, ...deck.groups.flatMap((group) => group.cards.map((entry) => entry.card))];
  const ids = [...new Set(cards.map(shownPrintingId).filter((id): id is string => id !== null))];

  const printing = new Map<string, { setCode: string; collectorNumber: string }>();
  if (ids.length > 0) {
    const { data, error } = await db
      .from("printings")
      .select("id, set_code, collector_number")
      .in("id", ids)
      .is("deleted_at", null);
    if (error) throw new Error(`Loading printings failed: ${error.message}`);
    for (const row of data ?? []) printing.set(row.id, { setCode: row.set_code.toUpperCase(), collectorNumber: row.collector_number });
  }

  const withPrinting = (card: CardSummary, entry: DeckExportEntry): DeckExportEntry => {
    const id = shownPrintingId(card);
    const found = id === null ? undefined : printing.get(id);
    return found ? { ...entry, ...found } : entry;
  };

  return [
    ...deck.commanders.map((card) => withPrinting(card, { name: card.name, quantity: 1, commander: true })),
    ...deck.groups.flatMap((group) =>
      group.cards.map((entry) =>
        withPrinting(entry.card, { name: entry.card.name, quantity: entry.quantity, commander: false }),
      ),
    ),
  ];
}
