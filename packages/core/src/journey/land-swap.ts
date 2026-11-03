import type { CardId, CardSummary } from '../contract';
import { isBasicLand } from './builder';
import type { StatLine } from './deck-tally';
import { copiesInDeck, type JourneyState } from './journey';

/**
 * Land swaps (T083): a deck that runs too many lands trades a basic for a spell, and one with too many basics but
 * enough lands trades a basic for a nonbasic land. One at a time, so the deck stays at 100.
 */
export type LandSwapMode = 'spells' | 'lands';

/** The stat line a mode brings back on target. */
export const LAND_SWAP_LINE: Readonly<Record<LandSwapMode, string>> = { spells: 'lands', lands: 'basicLands' };

/** Over the typical count as Deck stats rounds it, the way its Trim and Find actions read it. */
const over = (line: StatLine | undefined): boolean => line !== undefined && line.value > Math.round(line.target);

/** Which land swap the deck needs, if any: too many lands first, then too many basics. */
export function landSwapMode(stats: readonly StatLine[]): LandSwapMode | null {
  if (over(stats.find((s) => s.key === 'lands'))) return 'spells';
  return over(stats.find((s) => s.key === 'basicLands')) ? 'lands' : null;
}

/** Whether a card can go in for a basic in this mode: a spell, or a land that isn't basic. */
export function fitsLandSwap(mode: LandSwapMode, card: Pick<CardSummary, 'typeLine'>): boolean {
  const front = card.typeLine.split(' // ')[0] ?? card.typeLine;
  const land = /\bLand\b/.test(front);
  return mode === 'spells' ? !land : land && !isBasicLand(card);
}

/** The basic land with the most copies in the deck as it stands, ties by name; null when the deck has none. */
export function basicToSwap(state: JourneyState, cards: ReadonlyMap<CardId, CardSummary>): CardSummary | null {
  let best: { card: CardSummary; copies: number } | null = null;
  for (const card of cards.values()) {
    if (!isBasicLand(card)) continue;
    const copies = copiesInDeck(state, card.id);
    if (copies === 0) continue;
    if (!best || copies > best.copies || (copies === best.copies && card.name < best.card.name)) best = { card, copies };
  }
  return best?.card ?? null;
}
