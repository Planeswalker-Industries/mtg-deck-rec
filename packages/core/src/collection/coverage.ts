import type { CardId, DeckConflict, DeckInput } from '../contract';
import type { CollectionCopies } from './availability';

/** Inventory allocated to one deck target; a held source may be the target itself or a twin. */
export type CoverageAllocation =
  | { status: 'owned'; quantity: number }
  | { status: 'stand-in'; quantity: number; sourceCardId: CardId }
  | { status: 'basic'; quantity: number }
  | { status: 'conflict'; quantity: number; sourceCardId: CardId; decks: DeckConflict[] }
  | { status: 'missing'; quantity: number };

export interface CoverageCard {
  cardId: CardId;
  quantity: number;
  allocations: CoverageAllocation[];
}

export interface DeckCoverage {
  total: number;
  owned: number;
  standIn: number;
  basic: number;
  conflict: number;
  missing: number;
  cards: CoverageCard[];
}

/** Allocate the collection's physical copies once across the whole deck, independently of recommendation availability. */
export function deckCoverage(
  deck: DeckInput,
  collection: CollectionCopies,
  twinGroups: ReadonlyMap<number, number>,
  basicLandIds: ReadonlySet<number>,
): DeckCoverage {
  const needed = new Map<CardId, number>();
  for (const id of new Set(deck.commanders)) needed.set(id, 1);
  for (const entry of deck.cards) {
    if (entry.section === 'main') needed.set(entry.cardId, (needed.get(entry.cardId) ?? 0) + entry.quantity);
  }

  const cards: CoverageCard[] = [...needed]
    .sort(([a], [b]) => a - b)
    .map(([cardId, quantity]) => ({ cardId, quantity, allocations: [] }));
  const result: DeckCoverage = { total: 0, owned: 0, standIn: 0, basic: 0, conflict: 0, missing: 0, cards };
  const free = new Map<number, number>();
  const held = new Map<number, number>();
  const holdingDecks = new Map<number, DeckConflict[]>();
  for (const [id, owned] of collection.owned) {
    if (owned <= 0) continue;
    const decks = collection.builtDecks
      .filter((d) => (d.copies.get(id) ?? 0) > 0)
      .map((d) => d.deck)
      .sort((a, b) => a.deckId.localeCompare(b.deckId));
    const heldCount = Math.min(owned, collection.builtDecks.reduce((sum, d) => sum + Math.max(0, d.copies.get(id) ?? 0), 0));
    free.set(id, Math.max(owned - heldCount, 0));
    held.set(id, heldCount);
    holdingDecks.set(id, decks);
  }

  const members = new Map<number, number[]>();
  for (const [id, group] of twinGroups) members.set(group, [...(members.get(group) ?? []), id]);

  const remaining = (card: CoverageCard) => card.quantity - card.allocations.reduce((sum, a) => sum + a.quantity, 0);
  const allocate = (card: CoverageCard, allocation: CoverageAllocation) => {
    card.allocations.push(allocation);
    if (allocation.status === 'stand-in') result.standIn += allocation.quantity;
    else result[allocation.status] += allocation.quantity;
  };
  for (const card of cards) {
    result.total += card.quantity;
    if (basicLandIds.has(card.cardId)) allocate(card, { status: 'basic', quantity: card.quantity });
  }

  // Reserve every target's own free copies before a different target can use them as twins.
  for (const card of cards) {
    if (basicLandIds.has(card.cardId)) continue;
    const quantity = Math.min(remaining(card), free.get(card.cardId) ?? 0);
    if (quantity > 0) {
      allocate(card, { status: 'owned', quantity });
      free.set(card.cardId, (free.get(card.cardId) ?? 0) - quantity);
    }
  }

  const allocateTwins = (pool: Map<number, number>, status: 'stand-in' | 'conflict') => {
    for (const card of cards) {
      if (basicLandIds.has(card.cardId)) continue;
      const group = twinGroups.get(card.cardId);
      if (group === undefined) continue;
      while (remaining(card) > 0) {
        const source = (members.get(group) ?? [])
          .filter((id) => id !== card.cardId && (pool.get(id) ?? 0) > 0)
          .sort((a, b) => (pool.get(b) ?? 0) - (pool.get(a) ?? 0) || a - b)[0];
        if (source === undefined) break;
        const quantity = Math.min(remaining(card), pool.get(source) ?? 0);
        if (status === 'stand-in') allocate(card, { status, quantity, sourceCardId: source as CardId });
        else allocate(card, { status, quantity, sourceCardId: source as CardId, decks: holdingDecks.get(source) ?? [] });
        pool.set(source, (pool.get(source) ?? 0) - quantity);
      }
    }
  };
  allocateTwins(free, 'stand-in');

  // Held exact copies have priority over held twins, but never over a free twin.
  for (const card of cards) {
    if (basicLandIds.has(card.cardId)) continue;
    const quantity = Math.min(remaining(card), held.get(card.cardId) ?? 0);
    if (quantity > 0) {
      allocate(card, { status: 'conflict', quantity, sourceCardId: card.cardId, decks: holdingDecks.get(card.cardId) ?? [] });
      held.set(card.cardId, (held.get(card.cardId) ?? 0) - quantity);
    }
  }
  allocateTwins(held, 'conflict');
  for (const card of cards) {
    const quantity = remaining(card);
    if (quantity > 0) allocate(card, { status: 'missing', quantity });
  }
  return result;
}
