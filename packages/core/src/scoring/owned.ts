import type { RecContext } from '../contract';

/** Whether suggestions are limited to owned cards: a collection in 'only' mode, which is also what an omitted mode means. */
export function ownedOnly(context: Pick<RecContext, 'ownership' | 'ownershipMode'>): boolean {
  return context.ownership !== null && (context.ownershipMode ?? 'only') === 'only';
}

/** Whether owned cards are ranked ahead of comparable ones without hiding the rest. */
export function ownedFirst(context: Pick<RecContext, 'ownership' | 'ownershipMode'>): boolean {
  return context.ownership !== null && context.ownershipMode === 'first';
}

/**
 * The key suggestions sort by. In 'first' mode an owned card moves up by `boost` (app_config.ownership.firstBoost), so
 * it passes unowned cards that score less than that much higher. The score shown stays the card's own, so its
 * breakdown still adds up.
 */
export function rankKey(total: number, owned: boolean, boost: number): number {
  return owned ? total + boost : total;
}
