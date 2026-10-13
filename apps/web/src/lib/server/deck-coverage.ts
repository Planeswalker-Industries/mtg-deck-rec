import { deckCoverage, type CollectionCopies } from "@mtg/core/collection";
import type { DeckCoverageResult, DeckInput } from "@mtg/core/contract";
import { fetchCardsById, toCardSummary } from "./cards";
import { loadTwinGroups } from "./collection-availability";
import type { PublicClient } from "./supabase";

export class CoverageCardNotFound extends Error {
  constructor() {
    super("One of those cards isn't in the catalog anymore.");
  }
}

/** Inventory and catalog reads are independent; only allocated source metadata needs a second card read. */
export async function loadDeckCoverage(
  db: PublicClient,
  deck: DeckInput,
  copies: CollectionCopies | Promise<CollectionCopies>,
): Promise<DeckCoverageResult> {
  const targets = [...new Set([...deck.commanders, ...deck.cards.filter((entry) => entry.section === "main").map((entry) => entry.cardId)])];
  const [collection, twins, targetRows] = await Promise.all([copies, loadTwinGroups(db), fetchCardsById(db, targets)]);
  if (targets.some((id) => !targetRows.has(id))) throw new CoverageCardNotFound();

  const basics = new Set([...targetRows].filter(([, row]) => row.is_basic_land).map(([id]) => id));
  const coverage = deckCoverage(deck, collection, twins, basics);
  const sourceIds = [...new Set(coverage.cards.flatMap((card) =>
    card.allocations.flatMap((allocation) =>
      allocation.status === "stand-in" || allocation.status === "conflict" ? [allocation.sourceCardId] : [],
    ),
  ))].filter((id) => !targetRows.has(id));
  const sourceRows = await fetchCardsById(db, sourceIds);
  if (sourceIds.some((id) => !sourceRows.has(id))) throw new CoverageCardNotFound();

  const rows = new Map([...targetRows, ...sourceRows]);
  return {
    coverage,
    cards: [...rows].sort(([a], [b]) => a - b).map(([, row]) => toCardSummary(row)),
  };
}
