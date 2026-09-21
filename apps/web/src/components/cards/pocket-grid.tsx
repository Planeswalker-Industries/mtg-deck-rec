import type { ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import type { Route } from "next";
import Link from "next/link";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";
import { ZoomableCard } from "./card-zoom";

export interface PocketItem {
  card: CardSummary;
  /** Shown under the card name; keep it to one or two short lines. */
  caption?: ReactNode;
  selected?: boolean;
  /** Makes the pocket a link, e.g. to the card's page. */
  href?: string;
}

const GRID_SIZES = "(min-width: 1024px) 160px, (min-width: 640px) 25vw, 33vw";

/**
 * Card images laid out like a binder page: 3 across on phones, up to 6 on wide screens.
 *
 * The columns answer to the **container**, not the viewport: the deck workspace puts this grid in a middle column
 * roughly half the page wide, where viewport breakpoints would have asked for six cards in the room for four.
 */
export function PocketGrid({
  items,
  label,
  onSelect,
  zoomable = false,
}: {
  items: PocketItem[];
  label: string;
  onSelect?: (card: CardSummary) => void;
  /** Hover to enlarge a card, or press its magnifier; pressing the card itself still selects it or follows its link. */
  zoomable?: boolean;
}) {
  return (
    <div className="@container">
      <ul aria-label={label} className="grid grid-cols-3 gap-x-2 gap-y-4 @md:grid-cols-4 @xl:grid-cols-5 @3xl:grid-cols-6">
        {items.map((item) => {
          const content = (
            <>
              <CardImage card={item.card} alt="" sizes={GRID_SIZES} />
              <span className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(item.card)}</span>
              {item.caption && <span className="mt-0.5 block text-xs leading-snug">{item.caption}</span>}
            </>
          );
          const pocket = onSelect ? (
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
          ) : item.href ? (
            <Link
              href={item.href as Route}
              className="block rounded-lg p-1 transition-colors hover:bg-sleeve/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {content}
            </Link>
          ) : (
            <div className="p-1">{content}</div>
          );
          return (
            <li key={item.href ?? item.card.id} className="min-w-0">
              {zoomable ? (
                <ZoomableCard card={item.card} trigger="icon">
                  {pocket}
                </ZoomableCard>
              ) : (
                pocket
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
