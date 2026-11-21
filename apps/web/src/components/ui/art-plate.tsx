import Image from "next/image";
import { cn } from "cn";
import { ArtCredit, type ArtCreditInfo } from "@/components/ui/art-credit";

/**
 * Art laid on a sheet like a print: a 2px brass frame with a small shadow, the painting cropped to fill it, and its
 * credit in the bottom right corner. Copy never sits on it; it sits beside or under it on the paper. The caller sizes
 * the plate (an aspect ratio, or a height from its grid row).
 *
 * Decorative (`alt=""`): the credit names the card. Card art crops are hotlinked from Scryfall, so they pass
 * `unoptimized`; the land vistas are local files and go through the image optimiser.
 */
export function ArtPlate({
  src,
  credit,
  sizes,
  position = "object-center",
  priority = false,
  unoptimized = false,
  className,
}: {
  src: string;
  credit: ArtCreditInfo;
  sizes: string;
  /** A Tailwind `object-*` class choosing which part of the art stays in frame. */
  position?: string;
  priority?: boolean;
  unoptimized?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "relative overflow-hidden border-2 border-brass bg-(--wood-bar) shadow-[0_2px_6px_-2px_color-mix(in_oklch,var(--wood-bar)_60%,transparent)]",
        className,
      )}
    >
      <Image src={src} alt="" fill priority={priority} unoptimized={unoptimized} sizes={sizes} className={cn("object-cover", position)} />
      <ArtCredit credit={credit} />
    </figure>
  );
}
