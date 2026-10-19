"use client";

import { useRef, useState, type ComponentProps } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from "lucide-react";
import type { StatLine } from "@mtg/core/journey";
import { cn } from "cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LevelBadge } from "./level";
import { DeckStatsPanel, towardTarget, type StatAction } from "./deck-stats-panel";

/** A drag this far up the footer opens the sheet; shorter is a tap. */
const SWIPE_OPEN_PX = 24;
/** A drag this far down the sheet's handle closes it. */
const SWIPE_CLOSE_PX = 48;
/** Lines the closed bar names for the card on screen; the sheet has the rest. */
const PREVIEW_LINES = 2;

type PanelProps = ComponentProps<typeof DeckStatsPanel>;

/**
 * Phones and tablets: a docked bar at the foot of the screen with the deck's level, opening the full readout as a
 * sheet. `dock` is the width from which the host shows a rail instead: below it the page reserves the bar's height
 * (globals.css, `data-deck-stats-dock`), and the host sets --deck-stats-dock so the swipe cards and sticky bars sit
 * above it.
 *
 * The sheet has one close control: its handle row (tap, or swipe down). SheetContent's own corner button is off.
 */
export function DeckStatsFooter({ className, dock, ...panel }: PanelProps & { className?: string; dock: "lg" | "xl" }) {
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
  };
  const startY = useRef<number | null>(null);
  const swiped = useRef(false);
  const previewLines = panel.preview
    ? report.stats.flatMap((stat) => {
        const delta = panel.preview?.get(stat.key) ?? 0;
        return delta === 0 ? [] : [{ stat, delta }];
      }).slice(0, PREVIEW_LINES)
    : [];

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
          {previewLines.length > 0 ? (
            // While a card is on screen the closed bar says what answering it would change, so a phone sees it too.
            <span className="flex min-w-0 items-center gap-3 text-sm">
              <span className="sr-only">Deck stats. This card: </span>
              {previewLines.map(({ stat, delta }) => {
                const better = towardTarget(stat.value, stat.target, delta);
                const Icon = better ? ArrowUp : ArrowDown;
                return (
                  <span key={stat.key} className="flex min-w-0 items-center gap-1">
                    <Icon aria-hidden className={cn("size-3.5 shrink-0", better ? "text-success" : "text-destructive")} strokeWidth={2.75} />
                    <span className="truncate">{stat.label}</span>
                    <span className="shrink-0 font-mono">
                      {stat.value}→{stat.value + delta}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : (
            <span className="font-heading text-base font-semibold">Deck stats</span>
          )}
          <span className="flex shrink-0 items-center gap-3">
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
            <DeckStatsPanel {...panel} {...actions} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
