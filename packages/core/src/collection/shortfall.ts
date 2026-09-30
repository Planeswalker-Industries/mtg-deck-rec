import type { CardId, DeckInput, ResolvedCollectionRow } from '../contract';
import { cardQuantity, GENERIC_ROW, setCardQuantity } from './edit';

/** Copies of a card a deck uses that its player doesn't own. */
export interface CollectionShortfall {
  cardId: CardId;
  missing: number;
}

/**
 * The cards a deck uses more copies of than the collection holds, and how many more: 12 Plains in the deck against 5
 * owned is 7 missing. Commanders count once each; only the main deck counts besides them.
 */
export function collectionShortfall(deck: DeckInput, owned: ReadonlyMap<CardId, number>): CollectionShortfall[] {
  const needed = new Map<CardId, number>();
  for (const id of deck.commanders) needed.set(id, (needed.get(id) ?? 0) + 1);
  for (const entry of deck.cards) {
    if (entry.section === 'main') needed.set(entry.cardId, (needed.get(entry.cardId) ?? 0) + entry.quantity);
  }
  return [...needed].flatMap(([cardId, quantity]) => {
    const have = owned.get(cardId) ?? 0;
    return have < quantity ? [{ cardId, missing: quantity - have }] : [];
  });
}

/** Copies per card across a browser collection's rows. */
export function ownedCounts(rows: readonly ResolvedCollectionRow[]): Map<CardId, number> {
  const counts = new Map<CardId, number>();
  for (const row of rows) counts.set(row.cardId, (counts.get(row.cardId) ?? 0) + row.quantity);
  return counts;
}

/** A browser collection's rows with the missing copies added, by the same rule as a hand edit (the generic row). */
export function withShortfallAdded(rows: readonly ResolvedCollectionRow[], shortfall: readonly CollectionShortfall[]): ResolvedCollectionRow[] {
  return shortfall.reduce<ResolvedCollectionRow[]>(
    (next, { cardId, missing }) => setCardQuantity(next, cardId, cardQuantity(next, cardId) + missing),
    [...rows],
  );
}

/** The missing copies as rows an account import merges in: no printing, the generic finish, condition and language. */
export function shortfallRows(shortfall: readonly CollectionShortfall[]): ResolvedCollectionRow[] {
  return shortfall.map(({ cardId, missing }, i) => ({
    rowNo: i + 1,
    printingId: null,
    cardId,
    ...GENERIC_ROW,
    quantity: missing,
    via: 'name_only',
    setCode: null,
  }));
}
