import Image from "next/image";
import { Fragment } from "react";
import { MANA_SYMBOL_URL } from "@/components/deck/color-identity";

/** A rules-text symbol: `{T}`, `{2}`, `{W/U}`, `{B/P}`. */
const SYMBOL = /\{([^{}]+)\}/g;
/** Intrinsic size for the SVG; it renders at 1em, the size of the text around it. */
const SYMBOL_PX = 16;

/** What a screen reader says for each symbol part; anything else (numbers, X) is read as written. */
const SPOKEN: Record<string, string> = {
  T: "tap",
  Q: "untap",
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
  S: "snow",
  E: "energy",
  P: "Phyrexian",
};

/** `W/U` → "white or blue", `B/P` → "Phyrexian black", `T` → "tap". */
export function spoken(symbol: string): string {
  const parts = symbol.split("/");
  if (parts[1] === "P") return `${SPOKEN.P} ${SPOKEN[parts[0] ?? ""] ?? parts[0]}`;
  return parts.map((part) => SPOKEN[part] ?? part).join(" or ");
}

/**
 * Oracle text with Scryfall's symbol images in place of `{T}`, `{C}`, `{W/U}` and the rest, the way the card prints
 * them. Scryfall names each file after the symbol without its slash (`{W/U}` is `WU.svg`). Each image carries the
 * symbol's spoken name, so the sentence still reads aloud.
 */
export function RulesText({ text }: { text: string }) {
  const pieces = text.split(SYMBOL);
  return (
    <>
      {pieces.map((piece, i) =>
        // split() with a capture group alternates text and symbol: odd indices are symbols.
        i % 2 === 1 ? (
          <Image
            key={i}
            src={MANA_SYMBOL_URL(piece.replace(/\//g, ""))}
            alt={spoken(piece)}
            width={SYMBOL_PX}
            height={SYMBOL_PX}
            unoptimized
            className="mx-px inline-block size-[1em] align-[-0.125em]"
          />
        ) : (
          <Fragment key={i}>{piece}</Fragment>
        ),
      )}
    </>
  );
}
