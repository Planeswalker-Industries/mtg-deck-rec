import type { CardCategory } from '../contract';
import type { RoleTarget } from './cut';
import type { ComponentWeights } from './swap';

/** Cards to add: mostly how decks with this commander play the card, then whether it fills a role the deck is short on. */
export const ADD_WEIGHTS: ComponentWeights = { tag: 0, manaValue: 0, staple: 0, corpus: 0.7, votes: 0, role: 0.3 };

/** The type a card is filed under when it has several (an artifact creature is a creature). */
const CATEGORY_PRECEDENCE: readonly CardCategory[] = [
  'creature',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'land',
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Category from the front face's card types (subtypes ignored), so a spell with a land back face is a spell. */
export function cardCategory(typeLine: string): CardCategory {
  const front = typeLine.split(' // ')[0] ?? typeLine;
  const types = (front.split('—')[0] ?? front).toLowerCase();
  return CATEGORY_PRECEDENCE.find((category) => types.includes(category)) ?? 'artifact';
}

/** How short the deck is in each role: 0 at or above its target, 1 with none at all. */
export function roleShortfalls(deckRoleCounts: ReadonlyMap<string, number>, targets: readonly RoleTarget[]): Map<string, number> {
  return new Map(
    targets.map((t) => [t.roleId, t.target > 0 ? clamp01((t.target - (deckRoleCounts.get(t.roleId) ?? 0)) / t.target) : 0]),
  );
}

/** The largest shortfall among the card's roles, and the short roles it fills, most needed first. */
export function roleGap(cardRoleIds: readonly string[], shortfalls: ReadonlyMap<string, number>): { gap: number; roleIds: string[] } {
  const filled = [...new Set(cardRoleIds)]
    .filter((role) => (shortfalls.get(role) ?? 0) > 0)
    .sort((a, b) => (shortfalls.get(b) ?? 0) - (shortfalls.get(a) ?? 0));
  return { gap: shortfalls.get(filled[0] ?? '') ?? 0, roleIds: filled };
}
