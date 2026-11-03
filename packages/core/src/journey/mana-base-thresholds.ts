// packages/core/src/journey/mana-base-thresholds.ts
/**
 * Frank Karsten, "How Many Sources Do You Need to Consistently Cast Your Spells? A 2022 Update" (ChannelFireball,
 * 2022; now on TCGplayer). Every number in this file is his, for 99-card Commander decks: 41 lands, the free first
 * mulligan (CR 103.4c), the starting player drawing (CR 800.7), London mulligans. Deck stats labels what it derives
 * from them as an estimate.
 */
export const KARSTEN_ARTICLE_URL =
  'https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/';

/** Coloured sources needed to cast a spell on curve: [coloured pips][mana value]. His 99-card column. */
export const KARSTEN_SOURCES_99: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 1: 19, 2: 19, 3: 18, 4: 16, 5: 15, 6: 14 },
  2: { 2: 30, 3: 28, 4: 26, 5: 23, 6: 22, 7: 20 },
  3: { 3: 36, 4: 33, 5: 30, 6: 28, 7: 26 },
  4: { 5: 36 },
};
/** His table stops at four pips of one colour (1CCCC); more reads that row. */
export const KARSTEN_MAX_PIPS = 4;
/** Gold cards need every colour at once, so he adds one source to each colour's requirement. */
export const GOLD_EXTRA_SOURCES = 1;
/** "Consistently" = at least 89 + M percent for a spell of mana value M (90% for a 1-drop)… */
export const CONSISTENCY_BASE_PCT = 89;
/** …up to 96% at mana value 7. */
export const CONSISTENCY_TOP_MANA_VALUE = 7;

/** Credit a source gets toward one colour, by kind. */
export const SOURCE_CREDIT = {
  /** A land that makes the colour, or a fetch land that can find one. */
  land: 1,
  /** Fabled Passage and other basic-only fetches in a deck of BASIC_FETCH_PARTIAL_FROM_COLOURS or more colours. */
  basicFetchManyColours: 2 / 3,
  /** A spell/land MDFC's land side (he counts mythic ones as 1; rarity isn't on CardSummary). */
  mdfcLand: 0.8,
  /** Mana creatures: "Bolt the Bird". */
  dork: 0.5,
  /** Mana rocks and other mana permanents of mana value 2 or less. */
  cheapRock: 0.75,
  /** Mana rocks of mana value 3 (turn-three ramp). */
  threeRock: 0.5,
  /** Land ramp spells of mana value 2 (Rampant Growth). */
  cheapRamp: 0.75,
  /** Land ramp spells of mana value 3 (Cultivate). */
  threeRamp: 0.5,
} as const;
/** A basic-only fetch makes one choice; from this many deck colours that choice can leave a colour short. */
export const BASIC_FETCH_PARTIAL_FROM_COLOURS = 3;
/** Dorks count for spells of mana value 2 or more (and above their own mana value). */
export const DORK_MIN_SPELL_MANA_VALUE = 2;
/** Rocks and ramp up to this mana value are cast by turn two… */
export const CHEAP_SOURCE_MAX_MANA_VALUE = 2;
/** …so they help spells from mana value 3. */
export const CHEAP_SOURCE_MIN_SPELL_MANA_VALUE = 3;
/** Turn-three rocks and ramp… */
export const THREE_SOURCE_MANA_VALUE = 3;
/** …help spells from mana value 5 (he skips turn four: you'd have better things to cast). */
export const THREE_SOURCE_MIN_SPELL_MANA_VALUE = 5;

/** The opening hand. */
export const OPENING_HAND_CARDS = 7;
/** A kept 7 holds this many lands or more (owner, 2026-11-02: a keepable hand, close to his free-mulligan model)… */
export const KEEP_MIN_LANDS = 2;
/** …and this many or fewer. */
export const KEEP_MAX_LANDS = 5;
/** The turns the mana-by-turn line checks: 3 mana by turn 3, 4 by 4, 6 by 6. */
export const MANA_BY_TURN_CHECKS = [3, 4, 6] as const;
