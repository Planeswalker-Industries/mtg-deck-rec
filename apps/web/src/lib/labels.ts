import type { Bracket, CardCategory, CorpusConfidence, CutReason, SwapResult } from "@mtg/core/contract";

export const cardCategoryLabel: Record<CardCategory, string> = {
  creature: "Creatures",
  instant: "Instants",
  sorcery: "Sorceries",
  artifact: "Artifacts",
  enchantment: "Enchantments",
  planeswalker: "Planeswalkers",
  battle: "Battles",
  land: "Lands",
};

export const cutReasonLabel: Record<CutReason, string> = {
  NOT_LEGAL: "Not legal in Commander",
  OUTSIDE_COLOR_IDENTITY: "Outside your commander's colors",
  LOW_SYNERGY: "Rarely played with this commander",
  ROLE_REDUNDANT: "Deck already has plenty of these",
  GAME_CHANGER_EXCLUDED: "Game Changer",
  OVER_BRACKET_GC_LIMIT: "Too many Game Changers for this bracket",
  HIGH_MANA_VALUE: "Expensive to cast",
  NOT_OWNED: "Not in your collection",
};

/** Fits under a card tile on a phone. */
export const cutReasonShortLabel: Record<CutReason, string> = {
  NOT_LEGAL: "Not legal",
  OUTSIDE_COLOR_IDENTITY: "Off-color",
  LOW_SYNERGY: "Low synergy",
  ROLE_REDUNDANT: "Redundant",
  GAME_CHANGER_EXCLUDED: "Game Changer",
  OVER_BRACKET_GC_LIMIT: "Over GC limit",
  HIGH_MANA_VALUE: "High mana value",
  NOT_OWNED: "Not owned",
};

/** Reasons that make a cut necessary rather than optional. */
export const HARD_CUT_REASONS: ReadonlySet<CutReason> = new Set([
  "NOT_LEGAL",
  "OUTSIDE_COLOR_IDENTITY",
  "GAME_CHANGER_EXCLUDED",
  "OVER_BRACKET_GC_LIMIT",
]);

export const emptySwapMessage: Record<NonNullable<SwapResult["emptyReason"]>, string> = {
  NO_TAGS_ON_TARGET: "We don't know what this card does yet, so we can't suggest replacements for it.",
  NOTHING_OWNED_FITS: "Nothing in your collection does a similar job.",
  NO_CANDIDATES: "No legal replacements fit this deck.",
};

export const bracketLabel: Record<Bracket, string> = {
  1: "1 Exhibition",
  2: "2 Core",
  3: "3 Upgraded",
  4: "4 Optimized",
  5: "5 cEDH",
};

export function confidenceMessage(confidence: CorpusConfidence, deckCount: number): string {
  const decks = `${deckCount.toLocaleString("en-US")} deck${deckCount === 1 ? "" : "s"}`;
  switch (confidence) {
    case "full":
      return `Based on ${decks} with this commander and what each card does.`;
    case "low":
      return `Based on ${decks} with this commander. That's limited data, so card function counts for more.`;
    case "none":
      return `Based on what each card does. ${deckCount === 0 ? "No decks" : `Only ${decks}`} with this commander so far.`;
  }
}

/** Game Changers are off by default for brackets 1–2 and on for 3–5. */
export function defaultIncludeGameChangers(bracket: Bracket): boolean {
  return bracket >= 3;
}
