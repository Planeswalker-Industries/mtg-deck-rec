import type { ReactNode } from "react";
import type { CardSummary } from "@mtg/core/contract";
import { Check, X } from "lucide-react";
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
  /**
   * Marks the card for a job: "cut" crosses it out, "add" ticks it. The mark glows around the card and its icon sits in
   * the upper part of the image, clear of the artist line.
   */
  mark?: "cut" | "add";
  /** Makes the pocket a link, e.g. to the card's page. */
  href?: string;
}

const GRID_SIZES = "(min-width: 1024px) 160px, (min-width: 640px) 25vw, 33vw";

/**
 * Every pocket is a thumbnail, at most 160 CSS px wide, so the grid takes Scryfall's `small` printing: `normal` is
 * 488x680 and ~93 KB a card, which for a hundred-card deck page is nine megabytes of images nobody is reading the
 * rules text off. The grid is where a card is recognised, not read; enlarging one (`zoomable`) fetches `large`.
 */
const GRID_VARIANT = "small";

/** The mark's glow, in the job's colour. */
const MARK_GLOW = {
  cut: "shadow-[0_0_0_2px_var(--cut),0_0_18px_color-mix(in_oklch,var(--cut),transparent_35%)]",
  add: "shadow-[0_0_0_2px_var(--add),0_0_18px_color-mix(in_oklch,var(--add),transparent_35%)]",
} as const;

function MarkedImage({ card, mark }: { card: CardSummary; mark: "cut" | "add" | undefined }) {
  if (!mark) return <CardImage card={card} variant={GRID_VARIANT} alt="" sizes={GRID_SIZES} />;
  const Icon = mark === "cut" ? X : Check;
  return (
    <span className="relative block">
      <CardImage card={card} variant={GRID_VARIANT} alt="" sizes={GRID_SIZES} className={cn(MARK_GLOW[mark], mark === "cut" && "saturate-50")} />
      {/* Upper 60% only: Scryfall's artist and copyright line along the bottom must stay visible. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-3/5 items-center justify-center">
        <Icon
          className={cn("size-3/5 drop-shadow-[0_2px_4px_rgb(0_0_0/0.8)]", mark === "cut" ? "text-cut" : "text-add")}
          strokeWidth={3}
        />
      </span>
    </span>
  );
}

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
  /**
   * Lets each card be enlarged. A pocket that selects or links keeps that press and gets a magnifier; a plain one is
   * enlarged by pressing the card itself. Hover works on both.
   */
  zoomable?: boolean;
}) {
  return (
    <div className="@container">
      <ul aria-label={label} className="grid grid-cols-3 gap-x-2 gap-y-4 @md:grid-cols-4 @xl:grid-cols-5 @3xl:grid-cols-6">
        {items.map((item) => {
          const content = (
            <>
              <MarkedImage card={item.card} mark={item.mark} />
              <span className="mt-1.5 line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(item.card)}</span>
              {item.caption && <span className="mt-0.5 block text-xs leading-snug">{item.caption}</span>}
            </>
          );
          const pocket = onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(item.card)}
              aria-pressed={(item.selected ?? false) || item.mark !== undefined}
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
                <ZoomableCard card={item.card} trigger={onSelect || item.href ? "icon" : "tap"}>
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
