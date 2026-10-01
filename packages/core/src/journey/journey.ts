import type { CardId, CardSummary, DeckCardEntry, DeckInput } from '../contract';
import { COMMANDER_DECK_SIZE } from '../formats/commander/validate';
import { decklistText, type DeckExportEntry } from '../parse/decklist-export';

/**
 * The deck journey: cut what works against the deck, add into the slots that opens, replace weaker fits, then review
 * the result. Each phase can be revisited; nothing touches the decklist until the player commits the result.
 */
export type JourneyPhase = 'cut' | 'add' | 'replace' | 'review';

export const JOURNEY_PHASES: readonly JourneyPhase[] = ['cut', 'add', 'replace', 'review'];

export interface JourneySwap {
  target: CardSummary;
  replacement: CardSummary;
}

/** A replacement the player passed on for one card, so it isn't offered for that card again this round. */
export interface DeclinedSwap {
  targetId: CardId;
  replacementId: CardId;
}

export interface JourneyState {
  phase: JourneyPhase;
  /**
   * The furthest phase this round has opened. Going back to an earlier phase keeps it, so the player can return to
   * where they were without stepping through each phase again, as long as nothing upstream changed the deck.
   */
  reached: JourneyPhase;
  /** The deck this round started from. Re-analyzing starts a new round from the result. */
  base: DeckInput;
  /** One copy each; a card with several copies (basic lands) can be cut more than once. */
  cuts: CardSummary[];
  /** Recommended cuts the player chose to keep, so they aren't dealt again this round. */
  kept: CardId[];
  adds: CardSummary[];
  /** Additions the player passed on, so the recomputed list doesn't offer them again. */
  declinedAdds: CardId[];
  swaps: JourneySwap[];
  /** Cards the player chose to keep in the Replace phase. */
  keptInReplace: CardId[];
  /** Replacements the player passed on in the Replace phase. */
  declinedSwaps: DeclinedSwap[];
}

export type JourneyAction =
  | { type: 'cut'; card: CardSummary }
  | { type: 'uncut'; cardId: CardId }
  | { type: 'keep'; cardId: CardId }
  | { type: 'add'; card: CardSummary }
  | { type: 'unadd'; cardId: CardId }
  | { type: 'declineAdd'; cardId: CardId }
  | { type: 'swap'; target: CardSummary; replacement: CardSummary }
  | { type: 'unswap'; targetId: CardId }
  | { type: 'keepInReplace'; cardId: CardId }
  | { type: 'declineSwap'; targetId: CardId; replacementId: CardId }
  | { type: 'goto'; phase: JourneyPhase }
  | { type: 'reset'; base: DeckInput };

export function startJourney(base: DeckInput): JourneyState {
  return { phase: 'cut', reached: 'cut', base, cuts: [], kept: [], adds: [], declinedAdds: [], swaps: [], keptInReplace: [], declinedSwaps: [] };
}

/** A phase's place in the journey: 0 for Cut through 3 for Review. */
export const phaseIndex = (phase: JourneyPhase): number => JOURNEY_PHASES.indexOf(phase);

const without = <T>(list: readonly T[], value: T) => list.filter((v) => v !== value);
const withValue = <T>(list: readonly T[], value: T) => (list.includes(value) ? [...list] : [...list, value]);

/** Copies of a card in the base deck's main section. */
function baseCopies(base: DeckInput, cardId: CardId): number {
  return base.cards.filter((c) => c.section === 'main' && c.cardId === cardId).reduce((n, c) => n + c.quantity, 0);
}

/**
 * Room left in the deck: how far it is below a full Commander deck. Usually that's the slots the cuts opened, but a deck
 * that came in over 100 cards gets none until it's down to size, and one that came in short has room without any cuts.
 */
export function openSlots(state: JourneyState): number {
  return Math.max(0, COMMANDER_DECK_SIZE - deckSize(workingDeck(state)));
}

/**
 * Applies one choice. A swap only counts while the card it replaces is in the deck, so any change that takes a card out
 * (undoing the addition or the swap that brought it in, cutting it) also drops the swaps that were replacing it; a
 * swap chosen for a card that is no longer there is ignored.
 */
export function journeyReducer(state: JourneyState, action: JourneyAction): JourneyState {
  const next = reduce(state, action);
  return next === state ? next : pruneSwaps(next);
}

function reduce(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'cut': {
      const id = action.card.id;
      const alreadyCut = state.cuts.filter((c) => c.id === id).length;
      if (alreadyCut >= baseCopies(state.base, id)) return state;
      return { ...state, cuts: [...state.cuts, action.card], kept: without(state.kept, id) };
    }
    case 'uncut': {
      const at = state.cuts.findIndex((c) => c.id === action.cardId);
      if (at < 0) return state;
      return { ...state, cuts: state.cuts.filter((_, i) => i !== at) };
    }
    case 'keep': {
      const cuts = state.cuts.filter((c) => c.id !== action.cardId);
      return { ...state, cuts, kept: withValue(state.kept, action.cardId) };
    }
    case 'add': {
      if (openSlots(state) === 0 || state.adds.some((c) => c.id === action.card.id)) return state;
      return { ...state, adds: [...state.adds, action.card], declinedAdds: without(state.declinedAdds, action.card.id) };
    }
    case 'unadd': {
      // A swap of the added card goes with it: its target is no longer in the deck.
      const swaps = state.swaps.filter((s) => s.target.id !== action.cardId);
      return { ...state, adds: state.adds.filter((c) => c.id !== action.cardId), swaps };
    }
    case 'declineAdd':
      return { ...state, declinedAdds: withValue(state.declinedAdds, action.cardId) };
    case 'swap': {
      const swaps = state.swaps.filter((s) => s.target.id !== action.target.id);
      if ((mainCounts({ ...state, swaps }).get(action.target.id) ?? 0) <= 0) return state;
      return {
        ...state,
        swaps: [...swaps, { target: action.target, replacement: action.replacement }],
        keptInReplace: without(state.keptInReplace, action.target.id),
      };
    }
    case 'unswap':
      return { ...state, swaps: state.swaps.filter((s) => s.target.id !== action.targetId) };
    case 'keepInReplace': {
      const swaps = state.swaps.filter((s) => s.target.id !== action.cardId);
      return { ...state, swaps, keptInReplace: withValue(state.keptInReplace, action.cardId) };
    }
    case 'declineSwap': {
      const { targetId, replacementId } = action;
      if (state.declinedSwaps.some((d) => d.targetId === targetId && d.replacementId === replacementId)) return state;
      return { ...state, declinedSwaps: [...state.declinedSwaps, { targetId, replacementId }] };
    }
    case 'goto': {
      if (state.phase === action.phase) return state;
      const reached = phaseIndex(action.phase) > phaseIndex(state.reached) ? action.phase : state.reached;
      return { ...state, phase: action.phase, reached };
    }
    case 'reset':
      return startJourney(action.base);
  }
}

function addCopies(counts: Map<CardId, number>, cardId: CardId, quantity: number) {
  counts.set(cardId, (counts.get(cardId) ?? 0) + quantity);
}

/** Main-deck copies before any swap: the base deck without its cuts, with the additions. */
function countsBeforeSwaps(state: JourneyState): Map<CardId, number> {
  const main = new Map<CardId, number>();
  for (const entry of state.base.cards) if (entry.section === 'main') addCopies(main, entry.cardId, entry.quantity);
  for (const cut of state.cuts) addCopies(main, cut.id, -1);
  for (const card of state.adds) addCopies(main, card.id, 1);
  return main;
}

/**
 * The deck before any swap: the base deck without its cuts, with the additions. The Swap phase deals its weaker fits
 * from this deck, so a card the player already swapped out stays on the list, marked with its replacement, and the
 * list stays the same however many swaps are picked from it.
 */
export function deckBeforeSwaps(state: JourneyState): DeckInput {
  return deckFromCounts(state, countsBeforeSwaps(state));
}

/** Main-deck copies as the deck stands. A swap whose card is already gone is skipped. */
function mainCounts(state: JourneyState): Map<CardId, number> {
  const main = countsBeforeSwaps(state);
  for (const { target, replacement } of state.swaps) {
    if ((main.get(target.id) ?? 0) <= 0) continue;
    addCopies(main, target.id, -1);
    addCopies(main, replacement.id, 1);
  }
  return main;
}

/** Drops the swaps whose card is no longer in the deck, in the order they were chosen, as mainCounts skips them. */
function pruneSwaps(state: JourneyState): JourneyState {
  const main = countsBeforeSwaps(state);
  const swaps: JourneySwap[] = [];
  for (const swap of state.swaps) {
    if ((main.get(swap.target.id) ?? 0) <= 0) continue;
    addCopies(main, swap.target.id, -1);
    addCopies(main, swap.replacement.id, 1);
    swaps.push(swap);
  }
  return swaps.length === state.swaps.length ? state : { ...state, swaps };
}

/** Copies of a card in the main deck as it stands. */
export function copiesInDeck(state: JourneyState, cardId: CardId): number {
  return Math.max(0, mainCounts(state).get(cardId) ?? 0);
}

/**
 * The choices that take one copy of a card out of the deck as it stands, wherever it came from: an addition is taken
 * back, a swap is undone and the card it replaced cut too (the slot stays open), and a card from the deck the round
 * started with is cut. Nothing when the card isn't in the deck.
 */
export function removeFromDeck(state: JourneyState, card: CardSummary): JourneyAction[] {
  if (copiesInDeck(state, card.id) === 0) return [];
  if (state.adds.some((a) => a.id === card.id)) return [{ type: 'unadd', cardId: card.id }];
  const swap = state.swaps.find((s) => s.replacement.id === card.id);
  if (swap) {
    const undo: JourneyAction = { type: 'unswap', targetId: swap.target.id };
    return [undo, ...removeFromDeck(journeyReducer(state, undo), swap.target)];
  }
  return [{ type: 'cut', card }];
}

/** The state with one copy of each card taken out of the deck (see removeFromDeck). */
export function withoutCards(state: JourneyState, cards: readonly CardSummary[]): JourneyState {
  return cards.reduce((current, card) => removeFromDeck(current, card).reduce(journeyReducer, current), state);
}

/**
 * The deck as it stands: the base deck without its cuts, with the additions, and with each swapped card replaced.
 * Sections other than main pass through untouched.
 */
export function workingDeck(state: JourneyState): DeckInput {
  return deckFromCounts(state, mainCounts(state));
}

function deckFromCounts(state: JourneyState, main: Map<CardId, number>): DeckInput {
  const cards: DeckCardEntry[] = state.base.cards.filter((c) => c.section !== 'main');
  for (const [cardId, quantity] of main) if (quantity > 0) cards.push({ cardId, quantity, section: 'main' });
  return { commanders: [...state.base.commanders], cards };
}

/**
 * One comparable value for a deck's contents: the same cards in any order give the same key. Lists made for a deck
 * remember its key, so they can be shown again rather than asked for again while the deck is unchanged.
 */
export function deckKey(deck: DeckInput): string {
  const main = new Map<CardId, number>();
  for (const entry of deck.cards) if (entry.section === 'main') addCopies(main, entry.cardId, entry.quantity);
  const cards = [...main].filter(([, quantity]) => quantity > 0).sort(([a], [b]) => a - b);
  return `${[...deck.commanders].sort((a, b) => a - b).join(',')}|${cards.map(([id, quantity]) => `${id}x${quantity}`).join(',')}`;
}

export interface DeckChange {
  cardId: CardId;
  quantity: number;
}

/** What changed in the main deck between two versions of it: net copies removed and added. */
export function deckDiff(before: DeckInput, after: DeckInput): { removed: DeckChange[]; added: DeckChange[] } {
  const net = new Map<CardId, number>();
  for (const entry of before.cards) if (entry.section === 'main') addCopies(net, entry.cardId, -entry.quantity);
  for (const entry of after.cards) if (entry.section === 'main') addCopies(net, entry.cardId, entry.quantity);
  const removed: DeckChange[] = [];
  const added: DeckChange[] = [];
  for (const [cardId, quantity] of net) {
    if (quantity < 0) removed.push({ cardId, quantity: -quantity });
    else if (quantity > 0) added.push({ cardId, quantity });
  }
  return { removed, added };
}

/** Copies in the deck, commanders included: 100 for a complete Commander deck. */
export function deckSize(deck: DeckInput): number {
  return deck.commanders.length + deck.cards.filter((c) => c.section === 'main').reduce((n, c) => n + c.quantity, 0);
}

/**
 * A clean decklist for a deck, in the Commander / Deck layout the parser reads back. Like a saved deck, only the
 * commanders and the main deck survive. `nameOf` returns null for a card it doesn't know, which is left out rather
 * than written as a line the parser would reject.
 */
export function decklistFor(deck: DeckInput, nameOf: (cardId: CardId) => string | null): string {
  const entry = (cardId: CardId, quantity: number, commander: boolean): DeckExportEntry[] => {
    const name = nameOf(cardId);
    return name === null ? [] : [{ name, quantity, commander }];
  };
  return decklistText([
    ...deck.commanders.flatMap((id) => entry(id, 1, true)),
    ...deck.cards.filter((c) => c.section === 'main').flatMap((c) => entry(c.cardId, c.quantity, false)),
  ]);
}
