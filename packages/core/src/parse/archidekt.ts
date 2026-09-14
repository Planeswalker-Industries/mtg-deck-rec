/**
 * Archidekt deck API responses (GET https://archidekt.com/api/decks/:id/) turned into decklist text, so an imported deck
 * goes through the same parser and name resolution as a pasted one.
 */

/** Categories that never count toward the deck, whatever the response says (includedInDeck isn't reliable). */
const OUTSIDE_DECK = new Set(['sideboard', 'maybeboard', 'considering']);

const DECK_LINK = /^https?:\/\/(?:www\.)?archidekt\.com\/(?:api\/)?decks\/(\d+)/i;

export interface ArchidektDecklist {
  name: string;
  /** "Commander" and "Deck" sections, one "quantity name" line per card. */
  text: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The deck id in an archidekt.com deck link, or null for anything else. */
export function archidektDeckId(url: string): number | null {
  const id = DECK_LINK.exec(url.trim())?.[1];
  return id ? Number(id) : null;
}

/** Decklist text for an Archidekt deck response, or null when the response doesn't look like one. */
export function archidektDecklist(body: unknown): ArchidektDecklist | null {
  if (!isObject(body) || !Array.isArray(body.cards) || !Array.isArray(body.categories)) return null;

  const excluded = new Set<string>();
  for (const category of body.categories) {
    if (!isObject(category) || typeof category.name !== 'string') return null;
    if (category.includedInDeck === false || OUTSIDE_DECK.has(category.name.toLowerCase())) excluded.add(category.name);
  }

  const commanders = new Map<string, number>();
  const main = new Map<string, number>();
  for (const entry of body.cards) {
    const card = isObject(entry) && isObject(entry.card) ? entry.card : null;
    const oracleCard = card && isObject(card.oracleCard) ? card.oracleCard : null;
    const name = oracleCard?.name;
    const quantity = isObject(entry) ? entry.quantity : undefined;
    if (typeof name !== 'string' || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return null;

    const categories = isObject(entry) && Array.isArray(entry.categories) ? entry.categories.filter((c): c is string => typeof c === 'string') : [];
    // A card's first category decides where it lives, matching how Archidekt counts deck size.
    const primary = categories[0];
    if (primary !== undefined && excluded.has(primary)) continue;
    const section = categories.includes('Commander') ? commanders : main;
    section.set(name, (section.get(name) ?? 0) + quantity);
  }

  const lines = (cards: ReadonlyMap<string, number>) => [...cards].map(([cardName, count]) => `${count} ${cardName}`);
  return {
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Archidekt deck',
    text: ['Commander', ...lines(commanders), '', 'Deck', ...lines(main), ''].join('\n'),
  };
}
