import Image from "next/image";
import type { CardImageSet, CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { displayName } from "@/lib/cards";

/** Real card corners: ~4.75% of the width, ~3.4% of the height. */
const CARD_CORNERS = "rounded-[4.75%/3.4%]";

/**
 * A card image from Scryfall's CDN. Never overlay anything on the lower part of the image:
 * Scryfall's guidelines require the artist and copyright line to stay visible.
 *
 * **Pick `variant` from the size the image is actually rendered at.** These are `unoptimized`, so `sizes` buys nothing:
 * there is no srcset and the browser fetches whatever `variant` names, whole. Scryfall's steps are `small` 146×204 at
 * ~13 KB, `normal` 488×680 at ~93 KB and `large` 672×936, so a thumbnail left on the default costs seven times its
 * weight — measured, one page of twenty search results was 1.83 MB of `normal` files in 112 px slots.
 *
 * Every grid of cards is `small`, up to the 160 px pockets of `PocketGrid`: a grid is where a card is recognised by its
 * art and name, not where its rules text is read, and a hundred-card deck page on `normal` is nine megabytes. `normal`
 * is for a card shown on its own at a few hundred pixels, and `large` for one someone has deliberately enlarged.
 */
export function CardImage({
  card,
  face = "front",
  variant = "normal",
  sizes = "33vw",
  alt,
  eager = false,
  className,
}: {
  card: CardSummary;
  face?: "front" | "back";
  variant?: keyof Omit<CardImageSet, "artCrop">;
  sizes?: string;
  /** Defaults to the card name. Pass "" when the name is already shown next to the image. */
  alt?: string;
  eager?: boolean;
  className?: string;
}) {
  const set = face === "back" ? card.images?.back : card.images?.front;
  const label = alt ?? (face === "back" ? `${displayName(card)} (back face)` : card.name);

  if (!set) {
    return (
      <div
        role={label ? "img" : undefined}
        aria-label={label || undefined}
        className={cn(
          "flex aspect-[488/680] w-full items-end border border-dashed border-input bg-sleeve p-2 text-xs text-muted-foreground",
          CARD_CORNERS,
          className,
        )}
      >
        {displayName(card)}
      </div>
    );
  }

  return (
    <Image
      src={set[variant]}
      alt={label}
      width={488}
      height={680}
      sizes={sizes}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      className={cn("aspect-[488/680] h-auto w-full bg-seam", CARD_CORNERS, className)}
    />
  );
}
