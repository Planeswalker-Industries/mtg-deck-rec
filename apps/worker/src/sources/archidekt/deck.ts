import { COMMANDER_FORMAT, type Deck } from './client';

/** Card categories that never count toward the 100, whatever the deck says (includedInDeck is unreliable). */
const OUTSIDE_DECK = new Set(['sideboard', 'maybeboard', 'considering']);

/** What aggregation keeps from an Archidekt deck: no names, owners, descriptions or printings. */
export interface SlimDeck {
  id: number;
  updatedAt: string;
  createdAt: string;
  edhBracket: number | null;
  /** Commander oracle ids, sorted, so partner pairs have one key. */
  commanders: string[];
  /** [oracle id, quantity] for the other cards in the 100. */
  cards: [string, number][];
}

export type RejectReason = 'not_commander_format' | 'private' | 'no_commander' | 'wrong_commander' | 'not_100_cards';

export type Qualification =
  | { ok: true; deck: SlimDeck; commanderNames: string[] }
  | { ok: false; reason: RejectReason };

/**
 * Decides whether a deck belongs in the corpus: Commander format, public, at least one card in the Commander
 * category (including `commanderOracleId` when given), and exactly 100 cards in the deck. Legality and color
 * identity are checked later against our own catalog, where the rules live.
 */
export function qualifyDeck(deck: Deck, commanderOracleId?: string): Qualification {
  if (deck.deckFormat !== COMMANDER_FORMAT) return { ok: false, reason: 'not_commander_format' };
  if (deck.private || deck.unlisted) return { ok: false, reason: 'private' };

  const excluded = new Set(
    deck.categories.filter((c) => !c.includedInDeck || OUTSIDE_DECK.has(c.name.toLowerCase())).map((c) => c.name),
  );
  // A card's first category decides where it lives, matching how Archidekt counts deck size.
  const inDeck = deck.cards.filter((card) => {
    const primary = card.categories[0];
    return primary === undefined || !excluded.has(primary);
  });

  const commanderNames = new Map<string, string>();
  for (const card of inDeck) {
    if (card.categories.includes('Commander')) commanderNames.set(card.oracleId, card.name);
  }
  if (commanderNames.size === 0) return { ok: false, reason: 'no_commander' };
  if (commanderOracleId !== undefined && !commanderNames.has(commanderOracleId)) {
    return { ok: false, reason: 'wrong_commander' };
  }

  const size = inDeck.reduce((sum, card) => sum + card.quantity, 0);
  if (size !== 100) return { ok: false, reason: 'not_100_cards' };

  const quantities = new Map<string, number>();
  for (const card of inDeck) {
    if (card.categories.includes('Commander')) continue;
    quantities.set(card.oracleId, (quantities.get(card.oracleId) ?? 0) + card.quantity);
  }

  const commanders = [...commanderNames.keys()].sort();
  return {
    ok: true,
    deck: {
      id: deck.id,
      updatedAt: deck.updatedAt,
      createdAt: deck.createdAt,
      edhBracket: deck.edhBracket,
      commanders,
      cards: [...quantities].sort(([a], [b]) => a.localeCompare(b)),
    },
    commanderNames: commanders.map((id) => commanderNames.get(id) ?? id),
  };
}
