import type { CardId } from '../contract';

/** A card the deck holds, as making room for a role needs it. */
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

export interface RoomInput {
  /** The deck's main cards, commanders left out (they are never cut). */
  cards: readonly RoomCard[];
  /** The role the player wants more of. */
  focusRoleId: string;
  roles: readonly RoomRole[];
  /** Cut scores from the cut list (0..1, higher cuts first); cards without one are absent. */
  cutScores: ReadonlyMap<CardId, number>;
  /** Cards the player already chose to keep while making room. */
  spared: ReadonlySet<CardId>;
}

/** How many cards making room for a role asks for: what it is short of its target, and at least one. */
export function roomNeeded(roles: readonly RoomRole[], focusRoleId: string): number {
  const role = roles.find((r) => r.roleId === focusRoleId);
  return role ? Math.max(1, Math.ceil(role.target - role.value)) : 1;
}

/**
 * The cards to offer as cuts when the player wants room for a role.
 * Never a land, and never a card that fills that role. Ranked without weights, in two tiers:
 * 1. cards on the cut list, strongest cut first (the server's own ranking);
 * 2. cards whose every tracked role is over its target (the deck has more of that than it needs), dearest first.
 * Cards outside both tiers are what the deck is built around, so they aren't offered; the list view still cuts anything.
 */
export function roomCuts({ cards, focusRoleId, roles, cutScores, spared }: RoomInput): CardId[] {
  const over = new Set(roles.filter((r) => r.value > r.target).map((r) => r.roleId));
  const tracked = new Set(roles.map((r) => r.roleId));
  const offered = cards.filter((c) => !c.isLand && !c.roles.includes(focusRoleId) && !spared.has(c.id));

  const listed = offered
    .filter((c) => cutScores.has(c.id))
    .sort((a, b) => (cutScores.get(b.id) ?? 0) - (cutScores.get(a.id) ?? 0) || a.id - b.id);
  const surplus = offered
    .filter((c) => !cutScores.has(c.id))
    .filter((c) => {
      const own = c.roles.filter((r) => tracked.has(r));
      return own.length > 0 && own.every((r) => over.has(r));
    })
    .sort((a, b) => b.manaValue - a.manaValue || a.id - b.id);

  return [...new Set([...listed, ...surplus].map((c) => c.id))];
}
