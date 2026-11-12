import { STAT_TOLERANCE_MIN_CARDS, STAT_TOLERANCE_SHARE, withinTolerance } from '../journey/deck-tally';
import { colourTarget, creditedSources, manaBase, sourceCredit, type ManaCard, type ManaEntry } from '../journey/mana-base';
import { curveBucket, isFrontLand, statCardType } from './curve';

/**
 * Deck stats' bands, shared by the builder and Fix so the two cannot disagree: a line is in line inside its band
 * (`withinTolerance`), and both count a card against the same lines.
 */

/** How far a line may sit from its target and still be in line: Deck stats' band (`withinTolerance`). */
export const tolerance = (target: number): number => Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
/** The most a line may hold and stay in its band. */
export const upperEdge = (target: number): number => target + tolerance(target);
/** The fewest a line may hold and stay in its band. */
export const lowerEdge = (target: number): number => target - tolerance(target);

/** Whole cards a line sits outside its band: 0 inside it, the cards to take out above it or to bring in below it. */
export function cardsOutsideBand(value: number, target: number): number {
  if (withinTolerance(value, target)) return 0;
  const cards = value > target ? value - Math.floor(upperEdge(target)) : Math.ceil(lowerEdge(target)) - value;
  // Out of the band is at least one card out, whatever the rounding of the edge says.
  return Math.max(1, cards);
}

/** What the bands read from a card. */
export interface BandCard {
  typeLine: string;
  manaValue: number;
}

/** A deck's counts on the banded lines. */
export interface BandCounts {
  roles: ReadonlyMap<string, number>;
  /** Nonland copies per counted card type (`statCardType`). */
  types: ReadonlyMap<string, number>;
  /** Nonland copies on a curve bar (`curveBucket`). */
  curveAt: (bar: number) => number;
}

/** The targets of the banded lines; a line without a target has no band. */
export interface BandTargets {
  roles: ReadonlyMap<string, number>;
  types: ReadonlyMap<string, number>;
  /** Deck stats' curve, bar by mana value; null: the curve has no bands. */
  curve: readonly number[] | null;
}

/**
 * How many lines one more copy of a card would push above the top of their band: its roles (a cycling land draws cards
 * too), and for a nonland its card type and its curve bar.
 */
export function bandsBroken(card: BandCard, roles: readonly string[], counts: BandCounts, targets: BandTargets): number {
  const over = (held: number, target: number | undefined) => (target !== undefined && held + 1 > upperEdge(target) ? 1 : 0);
  const broken = roles.reduce((n, role) => n + over(counts.roles.get(role) ?? 0, targets.roles.get(role)), 0);
  if (isFrontLand(card.typeLine)) return broken;
  const type = statCardType(card.typeLine);
  const bar = Number(curveBucket(card.manaValue));
  return (
    broken +
    (type ? over(counts.types.get(type) ?? 0, targets.types.get(type)) : 0) +
    (targets.curve !== null ? over(counts.curveAt(bar), targets.curve[bar]) : 0)
  );
}

/** A deck colour's source target: its hardest card's Karsten number (capped), and that card's mana value. */
export interface ColourNeedTarget {
  colour: string;
  manaValue: number;
  target: number;
}

/** Each deck colour's source target for a deck, in WUBRG order. */
export function colourNeeds(
  main: readonly ManaEntry[],
  commanders: readonly ManaCard[],
  deckColours: string,
  cap: number | null,
): ColourNeedTarget[] {
  return manaBase(main, commanders, deckColours)
    .colours.filter((n) => deckColours.includes(n.colour))
    .map((n) => ({ colour: n.colour, manaValue: n.manaValue, target: colourTarget(n.needed, cap) }));
}

/** Each colour's sources short of its target in `main` (negative: sources to spare). */
export function colourDeficits(needs: readonly ColourNeedTarget[], main: readonly ManaEntry[], deckColours: string): Map<string, number> {
  return new Map(needs.map((n) => [n.colour, n.target - creditedSources(main, n.colour, n.manaValue, deckColours)]));
}

/** Whether a card makes (or finds) a colour still short of its target. */
export function fixesShortColour(
  card: ManaCard,
  needs: readonly ColourNeedTarget[],
  short: ReadonlyMap<string, number>,
  deckColours: string,
): boolean {
  return needs.some((n) => (short.get(n.colour) ?? 0) > 0 && sourceCredit(card, n.colour, n.manaValue, deckColours) > 0);
}
