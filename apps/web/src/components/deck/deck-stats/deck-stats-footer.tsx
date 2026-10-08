"use client";

import { useRef, useState, type ComponentProps } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LevelBadge } from "./level";
import { DeckStatsPanel } from "./deck-stats-panel";

/** A drag this far up the footer opens the sheet; shorter is a tap. */
const SWIPE_OPEN_PX = 24;
/** A drag this far down the sheet's handle closes it. */
const SWIPE_CLOSE_PX = 48;

type PanelProps = ComponentProps<typeof DeckStatsPanel>;

/**
 * Phones and tablets: a docked bar at the foot of the screen with the deck's level, opening the full readout as a
 * sheet. The host reserves its height (--deck-stats-dock) so the swipe cards size around it.
 *
 * The sheet has one close control: its handle row (tap, or swipe down). SheetContent's own corner button is off.
 */
export function DeckStatsFooter({ className, ...panel }: PanelProps & { className?: string }) {
  const { report } = panel;
  const [open, setOpen] = useState(false);
  const startY = useRef<number | null>(null);
  const swiped = useRef(false);

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-seam bg-sleeve pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls="deck-stats-sheet"
          className="page-column flex min-h-12 w-full cursor-pointer touch-none items-center justify-between gap-3 px-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          onPointerDown={(e) => {
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
          onClick={() => {
            if (swiped.current) return;
            setOpen((o) => !o);
          }}
        >
          <span className="font-heading text-base font-semibold">Deck stats</span>
          <span className="flex items-center gap-3">
            <LevelBadge level={report.level} okCount={report.okCount} total={report.total} />
            <ChevronUp aria-hidden className="size-5 text-muted-foreground" />
          </span>
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          id="deck-stats-sheet"
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          className="mx-auto max-h-[75lvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve px-4 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            aria-label="Close deck stats"
            className="mx-auto flex min-h-11 w-full cursor-pointer touch-none items-center justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
            onPointerDown={(e) => {
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
          <div className="pt-2">
            <DeckStatsPanel {...panel} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
