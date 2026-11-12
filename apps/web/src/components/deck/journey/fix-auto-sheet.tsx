"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import type { FixMove } from "@mtg/core/journey";
import { cn } from "cn";
import { CardPlate } from "@/components/cards/card-plate";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { displayName } from "@/lib/cards";
import type { StatScore } from "./use-fix";

/** A move in the plan, with its place in it: the plan may bring a basic land in more than once, so cards don't key it. */
interface PlannedMove {
  index: number;
  move: FixMove;
}

/** The plan's moves under the lines they are for, lines in the order the plan first meets them. */
function byLine(moves: readonly FixMove[]): { line: string; moves: PlannedMove[] }[] {
  const groups = new Map<string, PlannedMove[]>();
  moves.forEach((move, index) => groups.set(move.line, [...(groups.get(move.line) ?? []), { index, move }]));
  return [...groups].map(([line, planned]) => ({ line, moves: planned }));
}

/** "3/11": a score in DM Mono. */
const scoreText = (score: StatScore | null) => (score ? `${score.okCount}/${score.total}` : "–");

/**
 * "Fix the rest for me": every move Fix has left, previewed before any is made. The moves sit under the line each is
 * for, as a row of two card plates, out then in. Every move starts selected; tapping either plate takes the move out of
 * the plan or puts it back. The header's score is the deck with the selected moves made, graded again on every change.
 * Apply makes them as one choice, so one Undo takes them all back.
 */
export function FixAutoSheet({
  moves,
  lineLabel,
  scoreWith,
  onCancel,
  onApply,
}: {
  moves: readonly FixMove[];
  lineLabel: (line: string) => string;
  scoreWith: (moves: readonly { in: CardSummary | null; out: CardSummary | null }[]) => StatScore | null;
  onCancel: () => void;
  onApply: (moves: FixMove[]) => void;
}) {
  /** The moves the player took out of the plan, by their place in it. */
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set());
  const chosen = moves.filter((_, index) => !dropped.has(index));
  const now = scoreWith([]);
  const after = scoreWith(chosen);
  const change = now && after ? after.okCount - now.okCount : 0;
  const Arrow = change > 0 ? ArrowUp : change < 0 ? ArrowDown : null;
  const toggle = (index: number) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <Sheet open onOpenChange={(open) => !open && onCancel()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto flex max-h-[85lvh] w-full max-w-xl flex-col gap-0 overflow-hidden rounded-t-2xl border-seam bg-sleeve p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-seam px-4 py-3">
          <div className="min-w-0">
            <SheetTitle className="font-heading text-base font-semibold">Fix the rest</SheetTitle>
            <SheetDescription className="text-xs">Tap a move to leave it out.</SheetDescription>
          </div>
          <p className="flex shrink-0 items-center gap-1.5 font-mono text-sm">
            <span className="sr-only">Deck stats in line: </span>
            <span className="text-muted-foreground">{scoreText(now)}</span>
            <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
            <span className={cn(change > 0 && "text-success", change < 0 && "text-destructive")}>{scoreText(after)}</span>
            {Arrow && <Arrow aria-hidden className={cn("size-3.5", change > 0 ? "text-success" : "text-destructive")} strokeWidth={2.75} />}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {moves.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No moves left to make.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div aria-hidden className="grid grid-cols-2 gap-1.5 text-xs font-semibold">
                <span className="text-cut">Out</span>
                <span className="text-add">In</span>
              </div>
              {byLine(moves).map((group) => (
                <section key={group.line} aria-label={lineLabel(group.line)} className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {lineLabel(group.line)} <span className="font-mono font-normal">{group.moves.length}</span>
                  </h3>
                  {group.moves.map(({ index, move }) => {
                    const selected = !dropped.has(index);
                    return (
                      <ul
                        key={index}
                        aria-label={`${displayName(move.out)} out, ${displayName(move.in)} in`}
                        className={cn("grid grid-cols-2 gap-1.5", !selected && "opacity-50")}
                      >
                        {/* Half a phone's width each: the name gets the room the mana cost would take. */}
                        <CardPlate card={move.out} quantity={1} mark="cut" selected={selected} showCost={false} onSelect={() => toggle(index)} />
                        <CardPlate card={move.in} quantity={1} mark="add" selected={selected} showCost={false} onSelect={() => toggle(index)} />
                      </ul>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-seam px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button type="button" size="lg" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="lg" disabled={chosen.length === 0} onClick={() => onApply(chosen)}>
            Apply {chosen.length}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
