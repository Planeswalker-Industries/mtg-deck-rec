import { Check, X } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import { offBy } from "@/components/deck/deck-stats/deck-stats-panel";
import { cn } from "cn";

/**
 * The deck's size against 100, marked: a green check when full, otherwise a red X with how far off it is. The saved
 * deck editor's header and the deck tool's Deckbuilder bar show it.
 */
export function CardCount({ size, className }: { size: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-mono">
        {size}/{COMMANDER_DECK_SIZE}
      </span>
      cards
      {size === COMMANDER_DECK_SIZE ? (
        <span className="inline-flex items-center gap-0.5 text-success">
          <Check aria-hidden className="size-4" />
          Full
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 text-destructive">
          <X aria-hidden className="size-4" />
          {offBy(size, COMMANDER_DECK_SIZE)}
        </span>
      )}
    </span>
  );
}
