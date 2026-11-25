import Image from "next/image";
import type { ReactEventHandler, Ref } from "react";
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
 * ~13 KB, `normal` 488×680 at ~93 KB and `large` 672×936.
 *
 * The variant must be at least twice the rendered width, so cards stay sharp on 2x screens (owner, 2026-11-22: grids
 * on `small` were blurry on desktop): `small` only for thumbnails up to 73 px wide, `normal` up to 244 px (every grid
 * of cards, the `PocketGrid` pockets included), and `large` for a card shown bigger or deliberately enlarged.
 */
export function CardImage({
  card,
  face = "front",
  variant = "normal",
  sizes = "33vw",
  alt,
  eager = false,
  className,
  ref,
  onLoad,
  onError,
}: {
  card: CardSummary;
  face?: "front" | "back";
  variant?: keyof Omit<CardImageSet, "artCrop">;
  sizes?: string;
  /** Defaults to the card name. Pass "" when the name is already shown next to the image. */
  alt?: string;
  eager?: boolean;
  className?: string;
  /** The image element, for a caller that checks whether it has already loaded (`DealtCard`). */
  ref?: Ref<HTMLImageElement>;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onError?: ReactEventHandler<HTMLImageElement>;
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
      ref={ref}
      src={set[variant]}
      alt={label}
      width={488}
      height={680}
      sizes={sizes}
      unoptimized
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      onLoad={onLoad}
      onError={onError}
      className={cn("aspect-[488/680] h-auto w-full bg-seam", CARD_CORNERS, className)}
    />
  );
}
