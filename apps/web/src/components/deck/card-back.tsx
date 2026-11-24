import Image from "next/image";
import { cn } from "cn";

/**
 * The card back art in public/, at its own pixel size: Scryfall's `normal` size (488×680), enough for a back up to
 * 244 px wide at 2x. Its corners are transparent. Next resizes it per `sizes`, so one source covers every use.
 */
const CARD_BACK = { src: "/card_back.webp", width: 488, height: 680 } as const;

/**
 * A card seen from the back, at card proportions and rounded like one.
 */
export function CardBack({
  sizes = "112px",
  /** For backs that show the moment they mount, like the shuffling deck: lazy ones start as empty card outlines. */
  eager = false,
  className,
}: {
  sizes?: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={CARD_BACK.src}
      alt=""
      aria-hidden
      width={CARD_BACK.width}
      height={CARD_BACK.height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      className={cn("aspect-[488/680] w-full rounded-[4.75%/3.4%] object-cover shadow-card-edge", className)}
    />
  );
}
