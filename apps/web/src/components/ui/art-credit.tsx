import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";

/** The card an art comes from and who painted it: a vista (`lib/landing-art.ts`) or a card's art crop. */
export interface ArtCreditInfo {
  cardName: string;
  cardSlug: string;
  artist: string;
}

/**
 * The credit link over art: light ink with the art's text shadow, since it sits on the painting, not on paper (the
 * paper theme's `CREDIT_LINK` is muted ink). Muted until hovered, like `CREDIT_LINK`, so it never competes with the copy.
 */
const CREDIT_ON_ART_LINK =
  "text-on-art text-(--wood-ink)/85 underline decoration-(--wood-ink)/50 underline-offset-2 transition-colors hover:text-(--wood-ink) hover:decoration-(--wood-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wood-ink)";

/**
 * The credit an art owes, in the bottom right corner of the plate that shows it (`ArtPlate`): the artist's name, linking
 * to the card the art comes from. The card and artist are on the link for screen readers and as its tooltip. A soft
 * shade under it keeps it legible over a bright painting.
 */
export function ArtCredit({ credit, className }: { credit: ArtCreditInfo; className?: string }) {
  const label = `Art from ${credit.cardName} by ${credit.artist}`;
  return (
    <p
      className={cn(
        "pointer-events-none absolute right-0 bottom-0 bg-[radial-gradient(ellipse_at_bottom_right,rgb(0_0_0/0.55),transparent_70%)] pt-4 pr-2 pb-1.5 pl-6 text-right text-xs",
        className,
      )}
    >
      <Link
        href={`/card/${credit.cardSlug}` as Route}
        className={cn(CREDIT_ON_ART_LINK, "pointer-events-auto")}
        aria-label={label}
        title={label}
      >
        {credit.artist}
      </Link>
    </p>
  );
}
