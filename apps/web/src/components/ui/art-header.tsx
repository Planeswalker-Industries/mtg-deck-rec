import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { ArtCreditInfo } from "@/components/ui/art-credit";
import { ArtPlate } from "@/components/ui/art-plate";
import { CREDIT_LINK } from "@/lib/constants";

/** How much of the art shows over the paper: enough to read as the card's, thin enough for ink copy on top. */
const ART_OPACITY = "opacity-35";
/** Fades the art towards the sheet's foot: full art over the top 35%, 30% left at the bottom (an alpha mask, not a colour). */
const ART_FADE_MASK = "[mask-image:linear-gradient(to_bottom,black_35%,rgb(0_0_0/0.3))]";

/**
 * A page's first sheet with a card's art across its full width, behind the copy: the commander, card and saved-deck
 * pages open on it. The art is laid thin over the paper (`ART_OPACITY`) and fades towards the foot, so the paper
 * shows through and ink copy stays legible on it; the credit sits in the bottom right corner.
 *
 * With `plate`, desktop (`lg` up) also frames the art in brass (`ArtPlate`) in a column beside the copy, over the
 * faded art (owner, 2026-11-22: commander and card pages); the plate carries the credit there, so the sheet's own
 * credit line is for phones and tablets only. Below `lg` the sheet stays as without it.
 *
 * An art crop carries no artist line of its own, so without `art` and `credit` the sheet shows no art at all:
 * uncredited art is worse than none. Card art crops are hotlinked from Scryfall, so they pass `unoptimized`.
 */
export function ArtHeader({
  art,
  credit,
  labelledBy,
  position = "object-[center_25%]",
  plate = false,
  className,
  children,
}: {
  art: string | null | undefined;
  credit: ArtCreditInfo | null;
  /** The id of the heading that names the section. */
  labelledBy: string;
  /** A Tailwind `object-*` class choosing which part of the art stays in frame. */
  position?: string;
  /** Frame the art beside the copy from `lg` as well. */
  plate?: boolean;
  /** Padding and layout of the sheet's content. */
  className?: string;
  children: ReactNode;
}) {
  const shown = art && credit;
  const plated = plate && shown;
  return (
    <section aria-labelledby={labelledBy} className="sheet overflow-hidden">
      {shown && (
        <div aria-hidden className={cn("pointer-events-none absolute inset-0", ART_FADE_MASK, ART_OPACITY)}>
          <Image
            src={art}
            alt=""
            fill
            unoptimized
            priority
            sizes="(min-width: 1024px) 80rem, 100vw"
            className={cn("object-cover", position)}
          />
        </div>
      )}
      <div className={cn("relative", plated && "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-8", className)}>
        {plated ? <div className="min-w-0">{children}</div> : children}
        {plated && (
          <ArtPlate
            src={art}
            credit={credit}
            sizes="22rem"
            position={position}
            priority
            unoptimized
            className="aspect-[4/3] self-start max-lg:hidden"
          />
        )}
      </div>
      {shown && (
        <p className={cn("relative px-4 pb-3 text-right text-xs text-muted-foreground sm:px-6", plated && "lg:hidden")}>
          Art from{" "}
          <Link href={`/card/${credit.cardSlug}` as Route} className={CREDIT_LINK}>
            {credit.cardName}
          </Link>{" "}
          by {credit.artist}
        </p>
      )}
    </section>
  );
}
