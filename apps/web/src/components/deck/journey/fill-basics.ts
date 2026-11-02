import { identityToMask } from "@mtg/core/commander";
import type { CardSummary } from "@mtg/core/contract";
import { BASIC_LAND_NAMES, isFrontLand, manaSymbols, splitBasics } from "@mtg/core/scoring";

/**
 * The basic lands that fill `count` holes in a deck, split as a build splits them: each colour of the commanders'
 * identity gets its share of the coloured mana symbols on the commanders and the deck's spells (Wastes when colourless).
 * As a decklist, so the names resolve to cards the way a pasted list does.
 */
export function basicsToFill(count: number, commanders: readonly CardSummary[], deck: readonly CardSummary[]): string {
  const mask = identityToMask(commanders.flatMap((c) => [...c.colorIdentity]));
  const symbols = new Map<string, number>();
  for (const card of [...commanders, ...deck]) {
    if (isFrontLand(card.typeLine)) continue;
    for (const [colour, n] of manaSymbols(card.manaCost)) symbols.set(colour, (symbols.get(colour) ?? 0) + n);
  }
  return [...splitBasics(count, mask, symbols)].map(([colour, quantity]) => `${quantity} ${BASIC_LAND_NAMES[colour]}`).join("\n");
}
