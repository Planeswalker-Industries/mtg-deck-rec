"use client";

import type { DeckId, DeckInput } from "@mtg/core/contract";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { DeckCoverage } from "@/components/deck/deck-coverage";
import { useDeckCoverage } from "@/components/deck/use-deck-coverage";

/**
 * A saved deck's coverage for its owner: how much of it their account collection holds, the same private read as the
 * deck tool's bar. Render it for the owner only; a browser collection or none shows nothing.
 */
export function SavedDeckCoverage({ deck, deckId }: { deck: DeckInput; deckId: DeckId }) {
  const { source, refresh, refreshing } = useCollectionSource();
  const status = useDeckCoverage(deck, source, deckId, source.kind === "account" && !refreshing);
  if (!status) return null;
  return <DeckCoverage status={status} retry={() => void refresh()} />;
}
