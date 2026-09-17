"use client";

import type { ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { displayName } from "@/lib/cards";

/**
 * The best thing a job has to say, under its button in the rail.
 *
 * One card, not a list: the rail's job is to tell you whether a job is worth opening, and the middle column is where
 * the rest of them go. The card itself isn't a control — "View all" is the only way in, so there's one obvious click.
 */
export function JobPreview({
  card,
  note,
  count,
  onViewAll,
}: {
  card: CardSummary;
  /** A line or two on why this card is first. */
  note: ReactNode;
  count: number;
  onViewAll: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-seam px-3 pt-3 pb-3">
      <div className="flex gap-3">
        <div className="w-16 shrink-0">
          <CardImage card={card} alt="" sizes="64px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] leading-tight font-bold">{displayName(card)}</p>
          <div className="mt-1 flex flex-col gap-0.5 text-xs leading-snug">{note}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onViewAll}
        className="self-start rounded-md py-1 text-sm font-bold text-primary transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        View all {count}
      </button>
    </div>
  );
}

/** What the rail says when a job has nothing to preview. */
export function JobNote({ children }: { children: ReactNode }) {
  return <p className="border-t border-seam px-3 py-3 text-xs leading-snug text-muted-foreground">{children}</p>;
}
