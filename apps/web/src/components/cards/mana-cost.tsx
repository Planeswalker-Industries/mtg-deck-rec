import Image from "next/image";
import { cn } from "cn";
import { MANA_SYMBOL_URL } from "@/components/deck/color-identity";
import { spoken } from "./rules-text";

/** One symbol of a cost: `{2}`, `{W}`, `{W/U}`, `{B/P}`. */
const SYMBOL = /\{([^{}]+)\}/g;
/** A split card's two halves ("{1}{R} // {1}{U}"). */
const HALVES = " // ";
/** Intrinsic size for the SVG; it renders at 1em, the size of the text around it. */
const SYMBOL_PX = 16;

/**
 * A printed mana cost as Scryfall's symbols, the way the card shows it. The wrapper carries the whole cost as one
 * accessible name ("2, white, white"), so a screen reader hears it once. Renders nothing for a card with no cost.
 */
export function ManaCost({ cost, className }: { cost: string; className?: string }) {
  if (cost.trim() === "") return null;
  const halves = cost.split(HALVES).map((half) => [...half.matchAll(SYMBOL)].map((m) => m[1] ?? ""));
  const label = halves.map((symbols) => symbols.map(spoken).join(", ")).join(", then ");
  return (
    <span role="img" aria-label={`Mana cost: ${label}`} className={cn("inline-flex shrink-0 items-center gap-px", className)}>
      {halves.map((symbols, h) => (
        <span key={h} className="inline-flex items-center gap-px">
          {h > 0 && <span className="mx-0.5 text-muted-foreground">/</span>}
          {symbols.map((symbol, i) => (
            <Image
              key={i}
              src={MANA_SYMBOL_URL(symbol.replace(/\//g, ""))}
              alt=""
              width={SYMBOL_PX}
              height={SYMBOL_PX}
              unoptimized
              className="size-[1em]"
            />
          ))}
        </span>
      ))}
    </span>
  );
}
