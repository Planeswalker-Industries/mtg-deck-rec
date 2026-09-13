import type { Bracket, CorpusConfidence, CutReason, SwapResult } from "@mtg/core/contract";

export const cutReasonLabel: Record<CutReason, string> = {
  NOT_LEGAL: "Not legal",
  OUTSIDE_COLOR_IDENTITY: "Outside color identity",
  LOW_SYNERGY: "Low synergy",
  ROLE_REDUNDANT: "Redundant role",
  GAME_CHANGER_EXCLUDED: "Game Changer excluded",
  OVER_BRACKET_GC_LIMIT: "Over bracket Game Changer limit",
  HIGH_MANA_VALUE: "High mana value",
  NOT_OWNED: "Not owned",
};

export const emptySwapMessage: Record<NonNullable<SwapResult["emptyReason"]>, string> = {
  NO_TAGS_ON_TARGET: "This card has no functional tags yet, so we can't find substitutes for it.",
  NOTHING_OWNED_FITS: "Nothing in your collection does a similar job.",
  NO_CANDIDATES: "No legal substitutes found for this deck.",
};

export const bracketLabel: Record<Bracket, string> = {
  1: "1 · Exhibition",
  2: "2 · Core",
  3: "3 · Upgraded",
  4: "4 · Optimized",
  5: "5 · cEDH",
};

export function confidenceMessage(confidence: CorpusConfidence, deckCount: number): string {
  const decks = `${deckCount.toLocaleString("en-US")} deck${deckCount === 1 ? "" : "s"}`;
  switch (confidence) {
    case "full":
      return `Based on ${decks} with this commander and each card's function.`;
    case "low":
      return `Based on ${decks} with this commander — limited data, leaning on card function.`;
    case "none":
      return `Based on card function only — ${deckCount === 0 ? "no" : `only ${decks}`} with this commander so far.`;
  }
}

/** Game Changers are off by default for brackets 1–2 and on for 3–5. */
export function defaultIncludeGameChangers(bracket: Bracket): boolean {
  return bracket >= 3;
}
