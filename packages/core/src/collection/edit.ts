import type { CardId, ResolvedCollectionRow } from '../contract';

/**
 * Editing a browser collection by hand, by the same rule the account's set_collection_card_quantity follows: a hand
 * edit is a card-level total. Copies added go into the card's generic row (no printing, nonfoil, NM, English: the
 * defaults an import uses); copies taken away come out of generic rows first, then out of the imported rows, latest
 * first, so the printings an import recorded are the last to go. 0 removes the card.
 */
export const GENERIC_ROW = { finish: 'nonfoil', condition: 'NM', lang: 'en' } as const;

const isGeneric = (row: ResolvedCollectionRow) =>
  row.printingId === null && row.finish === GENERIC_ROW.finish && row.condition === GENERIC_ROW.condition && row.lang === GENERIC_ROW.lang;

/** Copies of a card across all its rows. */
export function cardQuantity(rows: readonly ResolvedCollectionRow[], cardId: CardId): number {
  return rows.filter((r) => r.cardId === cardId).reduce((n, r) => n + r.quantity, 0);
}

export function setCardQuantity(rows: readonly ResolvedCollectionRow[], cardId: CardId, quantity: number): ResolvedCollectionRow[] {
  const wanted = Math.max(0, Math.floor(quantity));
  const total = cardQuantity(rows, cardId);
  if (wanted === total) return [...rows];
  if (wanted === 0) return rows.filter((r) => r.cardId !== cardId);

  if (wanted > total) {
    const at = rows.findIndex((r) => r.cardId === cardId && isGeneric(r));
    if (at >= 0) return rows.map((r, i) => (i === at ? { ...r, quantity: r.quantity + wanted - total } : r));
    const rowNo = rows.reduce((max, r) => Math.max(max, r.rowNo), 0) + 1;
    return [...rows, { rowNo, printingId: null, cardId, ...GENERIC_ROW, quantity: wanted - total, via: 'name_only', setCode: null }];
  }

  // Generic rows first, then the rest latest first: the order copies leave in.
  const order = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.cardId === cardId)
    .sort((a, b) => Number(isGeneric(b.row)) - Number(isGeneric(a.row)) || b.index - a.index);
  let surplus = total - wanted;
  const next = new Map<number, number>();
  for (const { row, index } of order) {
    if (surplus === 0) break;
    const taken = Math.min(row.quantity, surplus);
    next.set(index, row.quantity - taken);
    surplus -= taken;
  }
  return rows.flatMap((row, index) => {
    const left = next.get(index);
    if (left === undefined) return [row];
    return left > 0 ? [{ ...row, quantity: left }] : [];
  });
}
