import Link from "next/link";
import type { Vista } from "@/lib/landing-art";
import { TEXT_LINK } from "@/lib/constants";

/** The credit a vista's art owes (`lib/landing-art.ts`), linking the card it comes from. */
export function ArtCredit({ vista, className }: { vista: Vista; className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      Art from{" "}
      <Link href={`/card/${vista.cardSlug}`} className={TEXT_LINK}>
        {vista.cardName}
      </Link>{" "}
      by {vista.artist}
    </p>
  );
}
