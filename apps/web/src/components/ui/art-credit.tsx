import Link from "next/link";
import { cn } from "cn";
import type { Vista } from "@/lib/landing-art";
import { CREDIT_LINK } from "@/lib/constants";

/**
 * The credit a vista's art owes (`lib/landing-art.ts`), as one link to the card the art comes from. The visible word
 * stays short so it never competes with the copy beside it; the card and artist are on the link for screen readers
 * and as its tooltip. It always sits in the bottom right corner of the art it credits: callers place it last in a flex
 * column or grid, and `self-end` (`justify-self-end` in a grid) puts it on the right.
 */
export function ArtCredit({ vista, className }: { vista: Vista; className?: string }) {
  const credit = `Art from ${vista.cardName} by ${vista.artist}`;
  return (
    <p className={cn("self-end justify-self-end text-right text-xs text-muted-foreground", className)}>
      <Link href={`/card/${vista.cardSlug}`} className={CREDIT_LINK} aria-label={credit} title={credit}>
        Artist
      </Link>
    </p>
  );
}
