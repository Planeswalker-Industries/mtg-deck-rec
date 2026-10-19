import type { CardId } from '../contract';
import { withinTolerance } from './deck-tally';

/** A card the deck holds, as trimming the deck reads it. */
export interface RoomCard {
  id: CardId;
  isLand: boolean;
  manaValue: number;
  /** The tracked role ids it fills. */
  roles: readonly string[];
}

/** One tracked role's count in the deck as it stands, against the commander's target. */
export interface RoomRole {
  roleId: string;
  value: number;
  target: number;
}

export interface TrimInput {
  /** The deck's main cards as it stands, commanders left out (they are never cut). */
  cards: readonly RoomCard[];
  roles: readonly RoomRole[];
  /** Whether the deck runs more lands than its target: only then are lands offered. */
  landsOver: boolean;
  /** Cut scores from the cut list (0..1, higher cuts first); cards without one are absent. */
  cutScores: ReadonlyMap<CardId, number>;
  /** Cards never offered: the ones the player chose to keep, and the ones added this round. */
  spared: ReadonlySet<CardId>;
  /** Only offer cards that fill this role: the player asked to trim it. */
  focusRoleId?: string | null;
}

/** Sorts a card off the cut list after every listed one: cut scores run 0..1. */
const UNLISTED_CUT_SCORE = -1;

const overTarget = (r: RoomRole) => r.value > r.target && !withinTolerance(r.value, r.target);
const shortOfTarget = (r: RoomRole) => r.value < r.target && !withinTolerance(r.value, r.target);

/**
 * The cards to offer when the deck has to come back down to 100, in the order to offer them. Ranked without weights,
 * in three tiers:
 * 1. cards on the cut list whose every tracked role is over its target, strongest cut first;
 * 2. the rest of the cut list, strongest cut first;
 * 3. cards off the cut list whose every tracked role is over its target, dearest first.
 * Never a card that fills a role the deck is short of, and never a land unless the deck has too many. Cards outside
 * every tier are what the deck is built around, so they aren't offered; the list view still cuts anything.
 */
export function trimCuts({ cards, roles, landsOver, cutScores, spared, focusRoleId = null }: TrimInput): CardId[] {
  const over = new Set(roles.filter(overTarget).map((r) => r.roleId));
  const short = new Set(roles.filter(shortOfTarget).map((r) => r.roleId));
  const tracked = new Set(roles.map((r) => r.roleId));
  const tracks = (c: RoomCard) => c.roles.filter((r) => tracked.has(r));
  const allOver = (c: RoomCard) => tracks(c).length > 0 && tracks(c).every((r) => over.has(r));

  const offered = cards.filter(
    (c) =>
      (landsOver || !c.isLand) &&
      !spared.has(c.id) &&
      !c.roles.some((r) => short.has(r)) &&
      (focusRoleId === null || c.roles.includes(focusRoleId)),
  );
  const byCut = (a: RoomCard, b: RoomCard) => (cutScores.get(b.id) ?? 0) - (cutScores.get(a.id) ?? 0) || a.id - b.id;
  const listed = offered.filter((c) => cutScores.has(c.id));
  const surplusListed = listed.filter(allOver).sort(byCut);
  const otherListed = listed.filter((c) => !allOver(c)).sort(byCut);
  const surplus = offered
    .filter((c) => !cutScores.has(c.id) && allOver(c))
    .sort((a, b) => b.manaValue - a.manaValue || a.id - b.id);

  return [...new Set([...surplusListed, ...otherListed, ...surplus].map((c) => c.id))];
}

export interface LastResortInput {
  /** The deck's main cards as it stands, commanders left out. */
  cards: readonly RoomCard[];
  roles: readonly RoomRole[];
  cutScores: ReadonlyMap<CardId, number>;
  spared: ReadonlySet<CardId>;
}

/**
 * The cards to swipe through once `trimCuts` has run out and the deck is still over 100, so Cut never stops short of
 * 100 while the player is still choosing. Lands aren't dealt one by one here: Cut offers them together, as counts the
 * player turns down. In order:
 * 1. every other card, strongest cut first, then unlisted cards dearest first;
 * 2. cards that fill a role the deck is short of, in the same order, last of all.
 * Spared cards (kept by the player, added this round) are never offered.
 */
export function lastResortCuts({ cards, roles, cutScores, spared }: LastResortInput): CardId[] {
  const short = new Set(roles.filter(shortOfTarget).map((r) => r.roleId));
  const fillsShort = (c: RoomCard) => c.roles.some((r) => short.has(r));
  const byCut = (a: RoomCard, b: RoomCard) => {
    const sa = cutScores.get(a.id);
    const sb = cutScores.get(b.id);
    if (sa !== undefined || sb !== undefined) return (sb ?? UNLISTED_CUT_SCORE) - (sa ?? UNLISTED_CUT_SCORE) || a.id - b.id;
    return b.manaValue - a.manaValue || a.id - b.id;
  };
  const spells = cards.filter((c) => !c.isLand && !spared.has(c.id));
  const rest = spells.filter((c) => !fillsShort(c)).sort(byCut);
  const needed = spells.filter(fillsShort).sort(byCut);
  return [...new Set([...rest, ...needed].map((c) => c.id))];
}
