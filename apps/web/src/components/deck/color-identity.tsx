import Image from "next/image";
import type { ColorIdentity as ColorIdentityValue } from "@mtg/core/contract";
import { cn } from "cn";

/** Scryfall's published mana-symbol SVGs, the same CDN the card images come from. */
export const MANA_SYMBOL_URL = (key: string) => `https://svgs.scryfall.io/card-symbols/${key}.svg`;

/** A pip beside text, a touch taller than the line's capitals. */
const PIP_PX = 18;
/** A pip standing on its own under a deck tile, where it carries the colours at a glance. */
export const PIP_LG_PX = 24;

export const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

/**
 * A color identity as Scryfall mana pips. An empty identity shows the colorless pip, so the row is never
 * blank. The wrapper carries the accessible name and each pip is decorative, so a screen reader hears the
 * colors once.
 */
export function ColorIdentity({
  identity,
  size = "md",
  className,
}: {
  identity: ColorIdentityValue;
  /** `lg` for a deck's colours read on their own, under its tile on /decks. */
  size?: "md" | "lg";
  className?: string;
}) {
  const keys = identity ? [...identity] : ["C"];
  const label = keys.map((key) => COLOR_NAMES[key] ?? key).join(", ");

  return (
    <span role="img" aria-label={`Color identity: ${label}`} className={cn("inline-flex", size === "lg" ? "gap-1.5" : "gap-1", className)}>
      {keys.map((key) => (
        <Image
          key={key}
          src={MANA_SYMBOL_URL(key)}
          alt=""
          width={size === "lg" ? PIP_LG_PX : PIP_PX}
          height={size === "lg" ? PIP_LG_PX : PIP_PX}
          unoptimized
          className={size === "lg" ? "size-6" : "size-[1.125rem]"}
        />
      ))}
    </span>
  );
}
