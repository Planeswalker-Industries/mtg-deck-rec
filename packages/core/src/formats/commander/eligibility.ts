/** What the Commander rules read to decide whether a card can lead a deck. */
export interface CommanderEligibilityInput {
  /** The front face's type line (a double-faced card is judged by its front). */
  frontTypeLine: string;
  /** The card's rules text, every face. */
  oracleText: string;
  /** The front face's printed power and toughness, null when it has none. */
  frontPower: string | null;
  frontToughness: string | null;
}

// A creature off the battlefield counts as a creature card for the rule (Grist, the Hunger Tide).
const CREATURE_OFF_BATTLEFIELD = /isn't on the battlefield, it's an? [^.\n]*\bcreature\b/i;

/**
 * True when the card can be a Commander deck's commander, the set Scryfall's `is:commander` finds: a legendary
 * creature card; a legendary Vehicle or Spacecraft with printed power and toughness (rule 903.3 since Edge of
 * Eternities); a legendary card that is a creature everywhere but the battlefield; a card whose text says it can be
 * your commander; or a Background. Legality (bans) is separate: Scryfall's `legalities.commander`.
 */
export function canBeCommander({ frontTypeLine, oracleText, frontPower, frontToughness }: CommanderEligibilityInput): boolean {
  if (/can be your commander/i.test(oracleText)) return true;
  if (!/\bLegendary\b/.test(frontTypeLine)) return false;
  if (/\bCreature\b/.test(frontTypeLine) || /\bBackground\b/.test(frontTypeLine)) return true;
  if (/\b(?:Vehicle|Spacecraft)\b/.test(frontTypeLine)) return frontPower !== null && frontToughness !== null;
  return CREATURE_OFF_BATTLEFIELD.test(oracleText);
}
