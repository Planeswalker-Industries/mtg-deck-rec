// packages/core/src/journey/land-search.ts

/** Basic land types and the colour each makes; "basic land card" can also find Wastes ({C}). */
const LAND_TYPE_COLOUR: Readonly<Record<string, string>> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
/** Every colour a basic (or any) land can make, in WUBRGC order. */
const ALL_LAND_COLOURS = ['W', 'U', 'B', 'R', 'G', 'C'];
/** The order colour letters are always written in. */
export const COLOUR_ORDER = 'WUBRGC';

/** The lands a card can put onto the battlefield from its owner's library. */
export interface LandSearch {
  /** WUBRGC letters, in that order. */
  colours: string[];
  /** Only basic lands (Evolving Wilds, a panorama): one colour per use, so Karsten credits it partly in 3+ colour decks. */
  basicOnly: boolean;
}

/**
 * Reads a card's rules text for "search your library for … land … onto the battlefield" (fetch lands, land ramp).
 * Each sentence is read on its own, so a search that puts the land into the hand (Expedition Map) finds nothing, and
 * "their library" (Path to Exile) is the opponent's ramp, not this card's. Reminder text is dropped first.
 */
export function landSearch(oracleText: string): LandSearch | null {
  const text = oracleText.replace(/\([^)]*\)/g, '');
  for (const sentence of text.split('.')) {
    const found = /search your library for (.+?) onto the battlefield/i.exec(sentence)?.[1];
    if (!found || !/\bcards?\b/i.test(found)) continue;
    const named = Object.keys(LAND_TYPE_COLOUR).filter((type) => new RegExp(`\\b${type}\\b`).test(found));
    const anyLand = /\bland cards?\b/i.test(found);
    if (named.length === 0 && !anyLand) continue;
    const colours = named.length > 0 ? named.map((type) => LAND_TYPE_COLOUR[type]!) : ALL_LAND_COLOURS;
    return {
      colours: [...new Set(colours)].sort((a, b) => COLOUR_ORDER.indexOf(a) - COLOUR_ORDER.indexOf(b)),
      basicOnly: /\bbasic\b/i.test(found),
    };
  }
  return null;
}
