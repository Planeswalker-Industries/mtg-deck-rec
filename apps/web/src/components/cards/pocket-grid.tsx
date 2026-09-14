import type { ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";

export interface PocketItem {
  card: CardSummary;
  /** Shown under the card name; keep it to one or two short lines. */
  caption?: ReactNode;
  selected?: boolean;
}

const GRID_SIZES = "(min-width: 1024px) 180px, (min-width: 768px) 20vw, (min-width: 640px) 25vw, 33vw";

/** Card images laid out like a binder page: 3 across on phones, up to 6 on wide screens. */
export function PocketGrid({
  items,
  label,
  onSelect,
}: {
  items: PocketItem[];
  label: string;
  onSelect?: (card: CardSummary) => void;
}) {
  return (
    <ul aria-label={label} className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {items.map((item) => {
        const content = (
          <>
            <CardImage card={item.card} alt="" sizes={GRID_SIZES} />
            <span className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(item.card)}</span>
            {item.caption && <span className="mt-0.5 block text-xs leading-snug">{item.caption}</span>}
          </>
        );
        return (
          <li key={item.card.id} className="min-w-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item.card)}
                aria-pressed={item.selected ?? false}
                className={cn(
                  "block w-full rounded-lg p-1 text-left transition-colors hover:bg-sleeve/70",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  item.selected && "bg-sleeve ring-2 ring-primary",
                )}
              >
                {content}
              </button>
            ) : (
              <div className="p-1">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
