import Image from "next/image";
import type { CardImageSet, CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { displayName } from "@/lib/cards";

/** Real card corners: ~4.75% of the width, ~3.4% of the height. */
const CARD_CORNERS = "rounded-[4.75%/3.4%]";

/**
 * A card image from Scryfall's CDN. Never overlay anything on the lower part of the image:
 * Scryfall's guidelines require the artist and copyright line to stay visible.
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
