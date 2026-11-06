import Link from "next/link";
import type { Vista } from "@/lib/landing-art";
import { TEXT_LINK } from "@/lib/constants";

/**
 * The credit a vista's art owes (`lib/landing-art.ts`), as one link to the card the art comes from. The visible word
 * stays short so it never competes with the copy beside it; the card and artist are on the link for screen readers
 * and as its tooltip.
 */
export function ArtCredit({ vista, className }: { vista: Vista; className?: string }) {
  const credit = `Art from ${vista.cardName} by ${vista.artist}`;
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      <Link href={`/card/${vista.cardSlug}`} className={TEXT_LINK} aria-label={credit} title={credit}>
        Artist
      </Link>
    </p>
  );
}
