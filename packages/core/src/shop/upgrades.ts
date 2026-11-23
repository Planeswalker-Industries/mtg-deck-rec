import type { SwapResult, UpgradeSuggestion } from '../contract';

// Upgrades worth buying (T102): for a deck the collection fully supplies, the unowned cards that would improve it most,
// one per deck card they replace. Pure, so the route and the mock APIs pick the same way.

/** How many upgrades Finish shows: one short list with one Buy. */
export const DEFAULT_UPGRADES_LIMIT = 5;

/**
 * The upgrades among the swap results of the deck's weakest cards: each target's best buy-list card by `gain`, a card
 * picked for one target never picked again for another (that target falls to its next card), ranked by `gain` alone
 * (name as tie-break), cut to `limit`.
 *
 * Each target's buy list arrives ranked and cut by gain per dollar (`buyList` in `scoring/rank.ts`), so a target's
 * candidates are already the ones worth their price; the pick across targets is by gain only, never by price.
 */
export function pickUpgrades(results: readonly SwapResult[], limit: number): UpgradeSuggestion[] {
  const taken = new Set<number>();
  const picks: UpgradeSuggestion[] = [];
  for (const result of results) {
    const best = [...(result.buyList ?? [])]
      .sort((a, b) => b.gain - a.gain || a.card.name.localeCompare(b.card.name))
      .find((s) => !taken.has(s.card.id));
    if (!best) continue;
    taken.add(best.card.id);
    picks.push({ ...best, target: result.target });
  }
  return picks.sort((a, b) => b.gain - a.gain || a.card.name.localeCompare(b.card.name)).slice(0, limit);
}
