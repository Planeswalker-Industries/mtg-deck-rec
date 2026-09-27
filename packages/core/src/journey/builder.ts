import type { CardId, CardSummary, DeckCardEntry, DeckInput } from '../contract';

/**
 * Deck edits for the deckbuilder, as pure functions over a DeckInput. Commanders live in both places a DeckInput keeps
 * them, `commanders` and a 'commander' entry in `cards`, so every edit keeps the two in step.
 */

/** A Commander deck leads with one commander, or two when they partner. */
export const MAX_COMMANDERS = 2;

/** Basic lands (snow ones included) are the cards a Commander deck may run more than one of. */
export function isBasicLand(card: Pick<CardSummary, 'typeLine'>): boolean {
  const front = card.typeLine.split(' // ')[0] ?? card.typeLine;
  return /\bBasic\b/.test(front) && /\bLand\b/.test(front);
}

const mainCopies = (deck: DeckInput, cardId: CardId) =>
  deck.cards.filter((c) => c.section === 'main' && c.cardId === cardId).reduce((n, c) => n + c.quantity, 0);

function withMain(deck: DeckInput, cardId: CardId, quantity: number): DeckInput {
  const others = deck.cards.filter((c) => !(c.section === 'main' && c.cardId === cardId));
  const entry: DeckCardEntry[] = quantity > 0 ? [{ cardId, quantity, section: 'main' }] : [];
  return { commanders: [...deck.commanders], cards: [...others, ...entry] };
}

/** How many copies of a card the deck has, commanders included. */
export function copiesOf(deck: DeckInput, cardId: CardId): number {
  return mainCopies(deck, cardId) + (deck.commanders.includes(cardId) ? 1 : 0);
}

/** Whether one more copy may go in: any basic land, anything else only when the deck doesn't have it yet. */
export function canAdd(deck: DeckInput, card: Pick<CardSummary, 'id' | 'typeLine'>): boolean {
  return isBasicLand(card) || copiesOf(deck, card.id) === 0;
}

/** One more copy in the main deck, when the singleton rule allows it; otherwise the deck unchanged. */
export function addCard(deck: DeckInput, card: Pick<CardSummary, 'id' | 'typeLine'>): DeckInput {
  if (!canAdd(deck, card)) return deck;
  return withMain(deck, card.id, mainCopies(deck, card.id) + 1);
}

/** Sets a main-deck card's copies; 0 takes it out. More than one only for basic lands. */
export function setQuantity(deck: DeckInput, card: Pick<CardSummary, 'id' | 'typeLine'>, quantity: number): DeckInput {
  const allowed = isBasicLand(card) ? Math.max(0, Math.floor(quantity)) : Math.min(1, Math.max(0, Math.floor(quantity)));
  return withMain(deck, card.id, allowed);
}

/** Takes a card out entirely, as a commander or from the main deck. */
export function removeCard(deck: DeckInput, cardId: CardId): DeckInput {
  return {
    commanders: deck.commanders.filter((id) => id !== cardId),
    cards: deck.cards.filter((c) => c.cardId !== cardId),
  };
}

/**
 * Makes a card a commander. `mode` 'replace' makes it the only one, sending the old commanders into the main deck so
 * nothing is lost; 'partner' adds it beside a single current commander. A card already in the main deck moves up.
 */
export function makeCommander(deck: DeckInput, card: Pick<CardSummary, 'id'>, mode: 'replace' | 'partner'): DeckInput {
  if (deck.commanders.includes(card.id)) return deck;
  if (mode === 'partner' && deck.commanders.length >= MAX_COMMANDERS) return deck;
  const without = withMain(deck, card.id, 0);
  const keep = mode === 'partner' ? without.commanders : [];
  const demoted = mode === 'replace' ? without.commanders : [];
  const cards = without.cards.filter((c) => c.section !== 'commander' || keep.includes(c.cardId));
  const next: DeckInput = {
    commanders: [...keep, card.id],
    cards: [...cards, { cardId: card.id, quantity: 1, section: 'commander' }],
  };
  return demoted.reduce((d, id) => withMain(d, id, mainCopies(d, id) + 1), next);
}

/** Replaces one copy of a main-deck card with another card, as a swap from the replacement sheet does. */
export function swapCard(deck: DeckInput, target: Pick<CardSummary, 'id' | 'typeLine'>, replacement: Pick<CardSummary, 'id' | 'typeLine'>): DeckInput {
  if (mainCopies(deck, target.id) === 0 || !canAdd(deck, replacement)) return deck;
  return addCard(setQuantity(deck, target, mainCopies(deck, target.id) - 1), replacement);
}

/** One row of a deck as save_deck stores it: the 99 and the commanders, nothing from other boards. */
export type DeckSaveRow = {
  cardId: CardId;
  quantity: number;
  section: 'commander' | 'main';
};

/**
 * Flattens a DeckInput into one row per card and section, the rows save_deck expects. A commander sits in both
 * `commanders` and `cards`, and save_deck writes all rows in one upsert that fails when a key repeats, so each
 * commander must come out once. Repeated main entries add up. Sideboard, maybeboard and companion are left out.
 */
export function deckSaveRows(deck: DeckInput): DeckSaveRow[] {
  const rows = new Map<string, DeckSaveRow>();
  const put = (cardId: CardId, section: DeckSaveRow['section'], quantity: number) => {
    const key = `${section}:${cardId}`;
    const existing = rows.get(key);
    if (section === 'commander') rows.set(key, { cardId, quantity: 1, section });
    else rows.set(key, { cardId, quantity: (existing?.quantity ?? 0) + quantity, section });
  };
  for (const cardId of deck.commanders) put(cardId, 'commander', 1);
  for (const c of deck.cards) {
    if (c.section === 'commander' || c.section === 'main') put(c.cardId, c.section, c.quantity);
  }
  return [...rows.values()];
}
