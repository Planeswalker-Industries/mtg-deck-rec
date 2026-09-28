/**
 * EDHREC commander pages (GET https://json.edhrec.com/pages/commanders/:slug.json) reduced to the numbers the app keeps:
 * how many decks the page covers and, per card, how many of them run it. EDHREC publishes aggregates, not decklists,
 * so this is a statistics source and never a deck source (docs/roadmap/card-graph-plan.md, "External statistics").
 *
 * Deliberately left out: `salt` and `rank` (popularity scores the app does not use, like Scryfall's edhrec_rank),
 * prices, images, articles and the page's presentation panels.
 */

export interface EdhrecCardStat {
  /** Scryfall card (printing) id EDHREC shows for the card. */
  printingId: string;
  name: string;
  /** Decks on the page that run the card. */
  decksWith: number;
  /** Decks that could have: the page's deck count, or fewer for a card newer than some of them. */
  potentialDecks: number;
  /** EDHREC's synergy: the card's share here minus its share in decks of the same colours. */
  synergy: number | null;
}

export interface EdhrecCommanderPage {
  /** Card names the page is about: one card, the two faces of one card, or two partners. */
  names: string[];
  /** Scryfall card (printing) id of the page's first commander. */
  printingId: string | null;
  deckCount: number;
  /** One entry per card, however many of the page's lists it appears in. */
  cards: EdhrecCardStat[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * The commander and card statistics on an EDHREC commander page, or null when the body isn't a commander page. Colour
 * group index pages (`/commanders/abzan`) share the URL space and have no `card`, so they come back null too.
 */
export function edhrecCommanderPage(body: unknown): EdhrecCommanderPage | null {
  const dict = isObject(body) && isObject(body.container) && isObject(body.container.json_dict) ? body.container.json_dict : null;
  const card = dict && isObject(dict.card) ? dict.card : null;
  if (!dict || !card || typeof card.name !== 'string' || !isCount(card.num_decks)) return null;

  const names = Array.isArray(card.names) ? card.names.filter((n): n is string => typeof n === 'string' && n.length > 0) : [];
  const cards = new Map<string, EdhrecCardStat>();
  for (const list of Array.isArray(dict.cardlists) ? dict.cardlists : []) {
    if (!isObject(list) || !Array.isArray(list.cardviews)) continue;
    for (const view of list.cardviews) {
      if (!isObject(view) || typeof view.id !== 'string' || typeof view.name !== 'string') continue;
      if (!isCount(view.num_decks) || !isCount(view.potential_decks) || view.potential_decks === 0) continue;
      if (cards.has(view.id)) continue;
      cards.set(view.id, {
        printingId: view.id,
        name: view.name,
        decksWith: Math.min(view.num_decks, view.potential_decks),
        potentialDecks: view.potential_decks,
        synergy: typeof view.synergy === 'number' && Number.isFinite(view.synergy) ? view.synergy : null,
      });
    }
  }

  return {
    names: names.length > 0 ? names : [card.name],
    printingId: typeof card.id === 'string' ? card.id : null,
    deckCount: card.num_decks,
    cards: [...cards.values()],
  };
}
