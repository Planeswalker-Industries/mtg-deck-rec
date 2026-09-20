import Image from "next/image";
import type { ColorIdentity as ColorIdentityValue } from "@mtg/core/contract";
import { cn } from "cn";

/** Scryfall's published mana-symbol SVGs, the same CDN the card images come from. */
export const MANA_SYMBOL_URL = (key: string) => `https://svgs.scryfall.io/card-symbols/${key}.svg`;

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
export function ColorIdentity({ identity, className }: { identity: ColorIdentityValue; className?: string }) {
  const keys = identity ? [...identity] : ["C"];
  const label = keys.map((key) => COLOR_NAMES[key] ?? key).join(", ");

  return (
    <span
      role="img"
      aria-label={`Color identity: ${label}`}
      className={cn("inline-flex gap-1", className)}
    >
      {keys.map((key) => (
        <Image
          key={key}
          src={MANA_SYMBOL_URL(key)}
          alt=""
          width={18}
          height={18}
          unoptimized
          className="size-[1.125rem]"
        />
      ))}
    </span>
  );
}
