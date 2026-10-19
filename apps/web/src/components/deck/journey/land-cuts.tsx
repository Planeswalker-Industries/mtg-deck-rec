"use client";

import type { CardSummary } from "@mtg/core/contract";
import { CardPlate } from "@/components/cards/card-plate";

/** One land in the deck the round started with: its copies then, and the copies left after this round's cuts. */
export interface LandCount {
  card: CardSummary;
  copies: number;
  left: number;
}

/**
 * The deck's lands as card plates with the deckbuilder's −/+ counts, for taking lands out a copy at a time in Cut:
 * − cuts a copy, + puts one back, up to the copies the deck started with. A land with every copy cut stays listed,
 * dimmed, so it can come back. Pressing a plate enlarges the card, for lands whose rules text matters.
 */
export function LandCuts({
  lands,
  onCut,
  onRestore,
  label = "Lands",
}: {
  lands: readonly LandCount[];
  onCut: (card: CardSummary) => void;
  onRestore: (card: CardSummary) => void;
  label?: string;
}) {
  if (lands.length === 0) return null;
  return (
    <ul aria-label={label} className="grid gap-1.5 sm:grid-cols-2">
      {lands.map(({ card, copies, left }) => (
        <CardPlate
          key={card.id}
          card={card}
          quantity={left}
          className={left === 0 ? "opacity-50" : undefined}
          onQuantity={(next) => {
            if (next < left) onCut(card);
            else if (next > left && left < copies) onRestore(card);
          }}
        />
      ))}
    </ul>
  );
}
