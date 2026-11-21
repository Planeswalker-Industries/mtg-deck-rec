"use client";

import { useMemo } from "react";
import type { CardId, CardSummary, DeckId, DeckInput } from "@mtg/core/contract";
import { missingFromCoverage, type ShoppingLine } from "@mtg/core/shop";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { useDeckCoverage } from "@/components/deck/use-deck-coverage";
import { ShoppingList } from "./shopping-list";

/** A saved deck has no round. */
const NO_ROUND: readonly CardId[] = [];

/**
 * The saved deck page's shopping list, for whoever is looking (T090). The page is public and server-rendered; the
 * viewer's collection lives in their browser or account, so this reads it here: with one, the cards it doesn't supply
 * ("Buylist"); without, the whole deck ("Buy this deck"). The deck maker's budget never shows here.
 */
export function SavedDeckShopping({
  deckId,
  isOwner,
  commanders,
  cards,
}: {
  deckId: DeckId;
  isOwner: boolean;
  commanders: readonly CardSummary[];
  /** The 99 (or fewer), in the page's order. */
  cards: readonly ShoppingLine[];
}) {
  const { source } = useCollectionSource();
  const entries = useMemo<ShoppingLine[]>(() => [...commanders.map((card) => ({ card, quantity: 1 })), ...cards], [commanders, cards]);
  const deck = useMemo<DeckInput>(
    () => ({
      commanders: commanders.map((c) => c.id),
      cards: [
        ...commanders.map((c) => ({ cardId: c.id, quantity: 1, section: "commander" as const })),
        ...cards.map((l) => ({ cardId: l.card.id, quantity: l.quantity, section: "main" as const })),
      ],
    }),
    [commanders, cards],
  );
  // The owner's own deck doesn't count as holding its cards away from itself.
  const coverage = useDeckCoverage(deck, source, isOwner ? deckId : undefined, true);
  const coverageData = coverage?.status === "ready" ? coverage.data.coverage : null;
  const checking = source.kind === "loading" || coverage?.status === "loading";
  const missing = useMemo(() => (checking ? undefined : coverageData ? missingFromCoverage(coverageData) : null), [checking, coverageData]);

  return (
    <div className="sheet p-4 sm:p-6">
      <ShoppingList
        // Neutral while the collection is checked: a visitor without one would otherwise see "missing" flash.
        title={missing === undefined ? "Shopping list" : missing === null ? "Buy this deck" : "Buylist"}
        entries={entries}
        missing={missing}
        roundIds={NO_ROUND}
        scopeToggle={false}
        headingLevel={2}
        folded
      />
    </div>
  );
}
