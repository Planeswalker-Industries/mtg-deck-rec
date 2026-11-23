import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";
import { ZoomableCard } from "./card-zoom";
import { OwnedCorner } from "./owned-corner";

/**
 * One side of a swap, as Fix and Swap lay it out side by side: Remove or Add in its job's colour (with its icon and
 * word), the card, its name, and a note under it. The card going out reads quieter than the one coming in.
 *
 * `nav` adds a row between the word and the card (Swap's options, its count of cards). Pass it on both sides, `null`
 * where there is nothing to show, so the two cards stay level.
 */
export function MoveCard({
  card,
  side,
  owned,
  nav,
  note,
}: {
  card: CardSummary;
  side: "out" | "in";
  owned?: boolean;
  nav?: ReactNode;
  note?: ReactNode;
}) {
  const Icon = side === "out" ? Minus : Plus;
  const word = side === "out" ? "Remove" : "Add";
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", side === "out" ? "text-cut" : "text-add")}>
        <Icon aria-hidden className="size-3.5" strokeWidth={2.75} />
        {word}
      </span>
      {nav !== undefined && <div className="-my-1.5 flex min-h-11 items-center justify-center">{nav}</div>}
      {/* The width is capped so both cards, the chips and the buttons fit a phone above the Deck stats footer. */}
      <div className="relative w-full max-w-28 sm:max-w-52">
        <ZoomableCard card={card}>
          <CardImage
            card={card}
            variant="normal"
            alt={`${word}: ${card.name}`}
            sizes="(max-width: 640px) 40vw, 208px"
            eager
            className={side === "out" ? "opacity-80 saturate-50" : undefined}
          />
        </ZoomableCard>
        {owned && <OwnedCorner />}
      </div>
      <p className="w-full text-center text-sm leading-tight font-semibold text-balance">{displayName(card)}</p>
      {note && <div className="flex flex-col items-center gap-0.5 text-center text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}
