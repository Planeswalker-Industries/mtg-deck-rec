import type { ReactNode } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";
import { ZoomableCard } from "./card-zoom";
import { DealtCard } from "./dealt-card";
import { OwnedCorner } from "./owned-corner";
import type { BrowseSwipeBind } from "./use-browse-swipe";

/**
 * The ‹ › look 28 px but take a 44 px tap: an invisible ring of 8 px around each (the row is 44 px tall, and the word
 * beside them takes no taps).
 */
const BROWSE_BUTTON =
  "relative after:absolute after:-inset-2 aria-disabled:cursor-default aria-disabled:opacity-50";

/** The ‹ › on the card going in: its options, as a swipe on the card goes through them. */
export interface MoveBrowse {
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * One side of a swap, as Fix and Swap lay it out side by side: OUT or IN in its job's colour (the word alone, owner
 * 2026-11-24), the card, its name, and a note under it. The card going out reads quieter than the one coming in. How many options
 * there are isn't shown (owner, 2026-11-24): it doesn't help the choice.
 *
 * `browse` puts ‹ › either side of the word, to go through the options. `nav` adds a row between the word and the card
 * (the rater's counts); pass it on both sides, `null` where there is nothing to show, so the two cards stay level.
 *
 * `swipe` makes the card swipeable to browse (Swap and Fix: the cards to take out on the card going out, the options
 * on the one going in); `tourTarget` names it for the tours. `deal` lays the card face down until its image has loaded
 * (`DealtCard`): the journey's cards; the rater's stay as they are.
 */
export function MoveCard({
  card,
  side,
  owned,
  browse,
  nav,
  note,
  swipe,
  tourTarget,
  deal = true,
}: {
  card: CardSummary;
  side: "out" | "in";
  owned?: boolean;
  browse?: MoveBrowse;
  nav?: ReactNode;
  note?: ReactNode;
  swipe?: BrowseSwipeBind;
  tourTarget?: string;
  deal?: boolean;
}) {
  const Face = deal ? DealtCard : CardImage;
  const word = side === "out" ? "Out" : "In";
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      {/* As tall as the ‹ › on both sides, so the two cards stay level; the word sits in the middle column, centred
          over its card whether or not ‹ › flank it. */}
      <div
        role={browse ? "group" : undefined}
        aria-label={browse ? "Replacement options" : undefined}
        className="grid min-h-11 w-full grid-cols-[1fr_auto_1fr] items-center gap-2"
      >
        {browse && (
          <Button
            type="button"
            size="icon-sm"
            aria-label="Previous option"
            // aria-disabled rather than disabled, so the button keeps focus as it reaches the first option.
            aria-disabled={!browse.canPrevious}
            onClick={browse.onPrevious}
            className={cn("justify-self-end", BROWSE_BUTTON)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        )}
        <span className={cn("col-start-2 text-sm font-semibold tracking-wide uppercase", side === "out" ? "text-cut" : "text-add")}>
          {word}
        </span>
        {browse && (
          // Solid primary, so the other options are seen (owner, 2026-11-24: testers missed them until swap 9 of 10).
          <Button
            type="button"
            size="icon-sm"
            aria-label="Next option"
            aria-disabled={!browse.canNext}
            onClick={browse.onNext}
            className={cn("justify-self-start", BROWSE_BUTTON)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        )}
      </div>
      {nav !== undefined && <div className="-my-1.5 flex min-h-11 items-center justify-center">{nav}</div>}
      {/* The width is capped so both cards, the chips and the buttons fit a phone above the Deck stats footer. */}
      <div data-tour={tourTarget} {...swipe} className={cn("relative w-full max-w-28 sm:max-w-52", swipe?.className)}>
        <ZoomableCard card={card}>
          <Face
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

/** Which card of a list this is, for the rater ("3 of 14"). The word is read out, not shown (owner, 2026-11-18). */
export function BrowseCount({ word, index, count }: { word: string; index: number; count: number }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">
      <span className="sr-only">{word} </span>
      {index + 1} of {count}
    </span>
  );
}

/** The row that holds a swap: the card going out, the swap mark, the card coming in. */
export const MOVE_PAIR_GRID = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-3";

/**
 * The swap mark between the two cards (the Swap button's icon): brass, as decoration on paper, since it does nothing
 * when pressed. Centred on the row's height, which puts it about level with the middle of the cards.
 */
export function SwapMark() {
  return <ArrowLeftRight aria-hidden className="size-5 self-center text-brass" strokeWidth={2.25} />;
}
