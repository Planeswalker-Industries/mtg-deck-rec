import type { DeckConflict, OwnershipInput } from '../contract';

/**
 * What a player's collection can put into a deck (docs/roadmap/scoring-design.md, "Availability", T059):
 *
 *   available(card) = owned copies of the card and its functional twins − copies held by the player's other built decks
 *   basic lands     = always available
 *
 * A card whose copies are all held by built decks is a conflict: still suggested, tagged with those decks, so the player
 * can free a copy there. A rules-identical twin the player owns stands in for a card they don't (Terramorphic Expanse
 * for Evolving Wilds).
 */

/** One of the player's other decks marked built, and the copies of each card it holds. */
export interface BuiltDeck {
  deck: DeckConflict;
  /** Copies by card id, over every section of the deck. */
  copies: ReadonlyMap<number, number>;
}

/** A player's collection as availability reads it. */
export interface CollectionCopies {
  /** Copies owned, by card id. */
  owned: ReadonlyMap<number, number>;
  /** The player's other decks marked built (account collections only; never the deck being improved). */
  builtDecks: readonly BuiltDeck[];
}

export type CardAvailability =
  /** `cardId` is the owned card that fills the slot: the card itself, or a twin standing in for it. */
  | { status: 'available'; cardId: number; owned: number; free: number }
  /** Every owned copy (of the card or its twins) is held by these built decks. */
  | { status: 'conflict'; cardId: number; owned: number; decks: DeckConflict[] }
  /** A basic land: always available, whatever the collection says. */
  | { status: 'basic'; owned: number }
  | { status: 'unowned' };

export interface Availability {
  of(cardId: number, isBasicLand?: boolean): CardAvailability;
  /** Every card a collection-limited pool may hold: the owned cards and every twin of one. */
  poolIds(): number[];
  /** Owned cards that could stand in for a twin: their rows must be loaded with the pool's. */
  standInIds(): number[];
}

/** Whether the card counts as the player's: available, a conflict or a basic land. */
export const isOwnedStatus = (a: CardAvailability): boolean => a.status !== 'unowned';

/** The collection a request's ownership describes; quantities default to one copy each, as before contract v20. */
export function sessionCopies(ownership: OwnershipInput | null): CollectionCopies | null {
  if (ownership?.kind !== 'session') return null;
  const owned = new Map<number, number>();
  ownership.ownedCardIds.forEach((id, i) => owned.set(id, (owned.get(id) ?? 0) + (ownership.quantities?.[i] ?? 1)));
  return { owned, builtDecks: [] };
}

/**
 * Availability over a collection. `twinGroups` maps every card that has a rules-identical twin to its group (the
 * group's base card id, `cards.equivalence_base_id`, the base included); cards without twins are left out.
 */
export function availability(collection: CollectionCopies, twinGroups: ReadonlyMap<number, number>): Availability {
  const members = new Map<number, number[]>();
  for (const [cardId, group] of twinGroups) members.set(group, [...(members.get(group) ?? []), cardId]);
  for (const list of members.values()) list.sort((a, b) => a - b);

  const held = (cardId: number) => collection.builtDecks.reduce((sum, d) => sum + (d.copies.get(cardId) ?? 0), 0);
  const ownedOf = (cardId: number) => collection.owned.get(cardId) ?? 0;
  const freeOf = (cardId: number) => Math.max(0, ownedOf(cardId) - held(cardId));
  const twinsOf = (cardId: number) => {
    const group = twinGroups.get(cardId);
    return group === undefined ? [] : (members.get(group) ?? []).filter((id) => id !== cardId);
  };

  const of = (cardId: number, isBasicLand = false): CardAvailability => {
    if (isBasicLand) return { status: 'basic', owned: ownedOf(cardId) };
    if (freeOf(cardId) > 0) return { status: 'available', cardId, owned: ownedOf(cardId), free: freeOf(cardId) };
    // An owned twin with a copy to spare stands in: the one with the most free copies, then the lowest id.
    const twin = twinsOf(cardId)
      .filter((id) => freeOf(id) > 0)
      .sort((a, b) => freeOf(b) - freeOf(a) || a - b)[0];
    if (twin !== undefined) return { status: 'available', cardId: twin, owned: ownedOf(twin), free: freeOf(twin) };
    const ownedIds = [cardId, ...twinsOf(cardId)].filter((id) => ownedOf(id) > 0);
    if (ownedIds.length === 0) return { status: 'unowned' };
    const decks = collection.builtDecks.filter((d) => ownedIds.some((id) => (d.copies.get(id) ?? 0) > 0)).map((d) => d.deck);
    const [first] = ownedIds;
    return { status: 'conflict', cardId: first ?? cardId, owned: ownedOf(first ?? cardId), decks };
  };

  return {
    of,
    poolIds: () => {
      const ids = new Set<number>();
      for (const [cardId, copies] of collection.owned) {
        if (copies <= 0) continue;
        ids.add(cardId);
        for (const twin of twinsOf(cardId)) ids.add(twin);
      }
      return [...ids].sort((a, b) => a - b);
    },
    standInIds: () => [...collection.owned].filter(([id, copies]) => copies > 0 && twinGroups.has(id)).map(([id]) => id).sort((a, b) => a - b),
  };
}
