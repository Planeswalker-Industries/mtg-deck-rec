"use client";

import type { BuildCard, BuildOrigin } from "@mtg/core/contract";
import { CardPanel } from "@/components/cards/card-panel";
import { isCardZoomEvent } from "@/components/cards/card-zoom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCardRules } from "@/lib/card-rules";
import { ScoreExplainer } from "../score-explainer";

/** Where a built card came from, in the player's words. */
const ORIGIN_LABEL: Record<BuildOrigin, string> = {
  kept: "From your list",
  pick: "Picked for this deck",
  fill: "Filled from cards to buy",
};

/** One built card up close: the card, where it came from and why it scored as it did. */
export function BuildCardSheet({ card, onClose }: { card: BuildCard | null; onClose: () => void }) {
  const rulesFor = useCardRules(card ? [card.card.id] : []);
  return (
    <Sheet open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        // A press on an enlarged card lands outside the sheet, and would otherwise close it along with the card.
        onInteractOutside={(e) => {
          if (isCardZoomEvent(e)) e.preventDefault();
        }}
        className="mx-auto max-h-[92dvh] w-full max-w-xl gap-3 overflow-y-auto rounded-t-2xl border-seam bg-sleeve p-4"
      >
        {card && (
          <>
            <SheetHeader className="p-0">
              {/* The panel shows the name; the title names the sheet for screen readers. */}
              <SheetTitle className="sr-only">{card.card.name}</SheetTitle>
              <SheetDescription>{ORIGIN_LABEL[card.origin]}</SheetDescription>
            </SheetHeader>
            <CardPanel card={card.card} rules={rulesFor(card.card.id)} />
            <ScoreExplainer score={card.score} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
