"use client";

import { useRef, useState, type ComponentProps } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import type { StatLine } from "@mtg/core/journey";
import { cn } from "cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LevelBadge } from "./level";
import { DeckStatsPanel, type StatAction } from "./deck-stats-panel";

/** A drag this far up the footer opens the sheet; shorter is a tap. */
const SWIPE_OPEN_PX = 24;
/** A drag this far down the sheet's handle closes it. */
const SWIPE_CLOSE_PX = 48;

type PanelProps = ComponentProps<typeof DeckStatsPanel>;

/** "→ 4/11": the score answering the card on screen would give, green with an up arrow when higher, red when lower. */
function ScoreAfter({ okCount, total, now }: { okCount: number; total: number; now: number }) {
  const Icon = okCount > now ? ArrowUp : okCount < now ? ArrowDown : null;
  const tone = okCount > now ? "text-success" : okCount < now ? "text-destructive" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="sr-only">With this card: </span>
      <span className={tone}>
        {okCount}/{total}
      </span>
      {Icon && <Icon aria-hidden className={cn("size-3.5", tone)} strokeWidth={2.75} />}
      <span className="sr-only">{okCount > now ? ", more lines in line" : okCount < now ? ", fewer lines in line" : ", no change"}</span>
    </span>
  );
}

/**
 * Phones and tablets: a docked bar at the foot of the screen with the deck's level, opening the full readout as a
 * sheet. `dock` is the width from which the host shows a rail instead: below it the page reserves the bar's height
 * (globals.css, `data-deck-stats-dock`), and the host sets --deck-stats-dock so the swipe cards and sticky bars sit
 * above it.
 *
 * Closed, the bar reads "Deck stats ⚠ 3/11", and "→ 4/11" while a card is on screen: the score answering it would
 * give. What the card changes line by line sits by the card (`StatChips`) and in the sheet.
 *
 * The sheet has one close control: its handle row (tap, or swipe down). SheetContent's own corner button is off.
 */
export function DeckStatsFooter({
  className,
  dock,
  previewScore = null,
  ...panel
}: PanelProps & {
  className?: string;
  dock: "lg" | "xl";
  /** The score with the card on screen answered (the tally graded with it in and out); null with no card on screen. */
  previewScore?: { okCount: number; total: number } | null;
}) {
  const { report } = panel;
  const [open, setOpen] = useState(false);
  // An action opens a step under the sheet, so the sheet closes first; left open it would hide what the action did.
  const closing = (action: StatAction | null | undefined): StatAction | null =>
    action
      ? {
          ...action,
          onSelect: () => {
            setOpen(false);
            action.onSelect();
          },
        }
      : null;
  const { actionFor } = panel;
  const actions = {
    actionFor: actionFor && ((stat: StatLine) => closing(actionFor(stat))),
    bracketAction: closing(panel.bracketAction),
    combosAction: closing(panel.combosAction),
  };
  const startY = useRef<number | null>(null);
  const swiped = useRef(false);

  return (
    <>
      <div
        data-deck-stats-dock={dock}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-seam bg-sleeve pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          // The sheet is only in the document while open, so the reference is too.
          aria-controls={open ? "deck-stats-sheet" : undefined}
          className="page-column flex min-h-12 w-full cursor-pointer touch-none items-center justify-between gap-3 px-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          onPointerDown={(e) => {
            // Captured, so a mouse drag that leaves the bar still ends here.
            e.currentTarget.setPointerCapture(e.pointerId);
            startY.current = e.clientY;
            swiped.current = false;
          }}
          onPointerUp={(e) => {
            if (startY.current !== null && startY.current - e.clientY > SWIPE_OPEN_PX) {
              swiped.current = true;
              setOpen(true);
            }
            startY.current = null;
          }}
          onClick={(e) => {
            // The click a mouse swipe ends with is skipped. A touch swipe fires none, so the flag can outlive it: a key's
            // click (detail 0) is never skipped, and clears it.
            const skip = swiped.current && e.detail > 0;
            swiped.current = false;
            if (skip) return;
            setOpen((o) => !o);
          }}
        >
          <span className="font-heading text-base font-semibold">Deck stats</span>
          <span className="flex shrink-0 items-center gap-2">
            <LevelBadge level={report.level} okCount={report.okCount} total={report.total} compact />
            {previewScore && <ScoreAfter okCount={previewScore.okCount} total={previewScore.total} now={report.okCount} />}
            <ChevronUp aria-hidden className="size-5 text-muted-foreground" />
          </span>
        </button>
      </div>
      <Sheet closeOnBack open={open} onOpenChange={setOpen}>
        <SheetContent
          id="deck-stats-sheet"
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          // A fixed header row over a body that scrolls on its own: a sticky header let the readout show above and
          // behind it, and the body's scroll never chains to the page.
          className="mx-auto flex max-h-[75lvh] w-full max-w-xl flex-col gap-0 overflow-hidden rounded-t-2xl border-seam bg-sleeve p-0"
        >
          <button
            type="button"
            aria-label="Close deck stats"
            className="mx-auto flex min-h-11 w-full shrink-0 cursor-pointer touch-none items-center justify-between gap-3 bg-sleeve px-4 pt-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startY.current = e.clientY;
            }}
            onPointerUp={(e) => {
              if (startY.current !== null && e.clientY - startY.current > SWIPE_CLOSE_PX) setOpen(false);
              startY.current = null;
            }}
            onClick={() => setOpen(false)}
          >
            {/* A span, not the default h2: a heading can't sit inside a button. It still names the dialog. */}
            <SheetTitle asChild>
              <span className="font-heading text-base font-semibold">Deck stats</span>
            </SheetTitle>
            <span className="flex items-center gap-3">
              <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />
              <ChevronDown aria-hidden className="size-5 text-muted-foreground" />
            </span>
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <DeckStatsPanel {...panel} {...actions} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
