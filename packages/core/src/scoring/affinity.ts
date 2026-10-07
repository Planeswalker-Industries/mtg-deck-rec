import type { ScoringConfig } from './config';

/**
 * Deck affinity (T064; docs/roadmap/card-graph-plan.md, "Deck affinity"): how strongly a card connects to the cards
 * already in this deck, from the pair tables.
 *
 *   pmi(A, c)  = w·ln(lift_K) + (1 − w)·ln(lift_global)     w = n_A,K / (n_A,K + β): thin commanders lean on the corpus
 *   affinity   = Σ_A idf(A)·max(0, pmi(A, c)) / Σ_A idf(A)  idf(A) = ln(1 / p̂(A|K)): Viscera Seer outweighs Arcane Signet
 *   score      = affinity / (affinity + halfValue)          0..1, half at `halfValue`
 *
 * A pair the tables don't hold reads as no association (lift 1): only positive associations are stored.
 */

export type AffinitySettings = ScoringConfig['affinity'];

/** pmi by card, then partner, both ways round. */
export type PmiIndex = ReadonlyMap<number, ReadonlyMap<number, number>>;

/** The pairs touching a deck's cards: its commander key's and the corpus's. */
export interface PairLifts {
  own: PmiIndex;
  global: PmiIndex;
}

/** What weighs a deck card in the average: its inclusion under the commander (or its baseline) and its decks there. */
export interface DeckCardWeight {
  /** p̂(A|K), or the card's colour baseline when the commander's decks don't run it. */
  rate: number;
  /** Decks of the commander's key running the card: the backoff's weight on the key's own pairs. */
  keyDecks: number;
}

/** pmi lookups from pair rows given as [cardA, cardB, lift]. */
export function pmiIndex(rows: readonly (readonly [number, number, number])[]): PmiIndex {
  const index = new Map<number, Map<number, number>>();
  const add = (a: number, b: number, pmi: number) => {
    let partners = index.get(a);
    if (!partners) index.set(a, (partners = new Map()));
    partners.set(b, pmi);
  };
  for (const [a, b, lift] of rows) {
    const pmi = Math.log(lift);
    add(a, b, pmi);
    add(b, a, pmi);
  }
  return index;
}

/**
 * The cards outside the deck its pairs point to most, as `serving_deck_affinity` picks its neighbours: summed pmi over
 * the deck's links, from the key's pairs for a card they know and the corpus's otherwise. For the evaluation, which has
 * no database; the app reads them with its other rows.
 */
export function pairNeighbours(deckIds: readonly number[], lifts: PairLifts, count: number, eligible: (cardId: number) => boolean): number[] {
  const deck = new Set(deckIds);
  const own = new Map<number, number>();
  const global = new Map<number, number>();
  for (const deckCard of deck) {
    for (const [other, pmi] of lifts.own.get(deckCard) ?? []) if (!deck.has(other)) own.set(other, (own.get(other) ?? 0) + pmi);
    for (const [other, pmi] of lifts.global.get(deckCard) ?? []) if (!deck.has(other)) global.set(other, (global.get(other) ?? 0) + pmi);
  }
  const strength = new Map(global);
  for (const [other, sum] of own) strength.set(other, sum);
  return [...strength]
    .filter(([id]) => eligible(id))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, count)
    .map(([id]) => id);
}

/** How many deck cards a card's affinity names as its strongest links. */
const PAIRED_WITH = 3;

export interface Affinity {
  /** 0..1. */
  value: number;
  /** The deck cards it connects to most, strongest first. */
  pairedWith: number[];
}

/**
 * A card's affinity to a deck (the deck's other cards: pass the deck without the card itself for a cut or a swap's
 * target). Null when no deck card carries any weight, so the component is left out rather than read as zero.
 */
export function deckAffinity(
  cardId: number,
  deckIds: readonly number[],
  lifts: PairLifts,
  weights: ReadonlyMap<number, DeckCardWeight>,
  settings: AffinitySettings,
): Affinity | null {
  let weighted = 0;
  let total = 0;
  const links: [number, number][] = [];
  for (const deckCard of new Set(deckIds)) {
    if (deckCard === cardId) continue;
    const weight = weights.get(deckCard);
    if (!weight || weight.rate <= 0 || weight.rate >= 1) continue;
    const idf = Math.log(1 / weight.rate);
    const share = weight.keyDecks / (weight.keyDecks + settings.backoffBeta);
    const pmi = share * (lifts.own.get(deckCard)?.get(cardId) ?? 0) + (1 - share) * (lifts.global.get(deckCard)?.get(cardId) ?? 0);
    total += idf;
    if (pmi > 0) {
      weighted += idf * pmi;
      links.push([deckCard, idf * pmi]);
    }
  }
  if (total === 0) return null;
  const raw = weighted / total;
  return {
    value: raw / (raw + settings.halfValue),
    pairedWith: links
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, PAIRED_WITH)
      .map(([id]) => id),
  };
}

/**
 * Deck affinity for a deck that grows one card at a time (a build, T063): `add` a card as it joins the deck, then `of`
 * gives every candidate's affinity exactly as `deckAffinity` would against the deck so far, without re-reading the
 * whole deck for each candidate. Candidates are never in the deck.
 */
export interface AffinityTracker {
  add(deckCard: number): void;
  of(cardId: number): Affinity | null;
}

export function affinityTracker(lifts: PairLifts, weights: ReadonlyMap<number, DeckCardWeight>, settings: AffinitySettings): AffinityTracker {
  const deck = new Set<number>();
  const weighted = new Map<number, number>();
  const links = new Map<number, [number, number][]>();
  let total = 0;
  return {
    add(deckCard) {
      if (deck.has(deckCard)) return;
      deck.add(deckCard);
      const weight = weights.get(deckCard);
      if (!weight || weight.rate <= 0 || weight.rate >= 1) return;
      const idf = Math.log(1 / weight.rate);
      const share = weight.keyDecks / (weight.keyDecks + settings.backoffBeta);
      total += idf;
      const own = lifts.own.get(deckCard);
      const global = lifts.global.get(deckCard);
      for (const cardId of new Set([...(own?.keys() ?? []), ...(global?.keys() ?? [])])) {
        const pmi = share * (own?.get(cardId) ?? 0) + (1 - share) * (global?.get(cardId) ?? 0);
        if (pmi <= 0) continue;
        weighted.set(cardId, (weighted.get(cardId) ?? 0) + idf * pmi);
        let list = links.get(cardId);
        if (!list) links.set(cardId, (list = []));
        list.push([deckCard, idf * pmi]);
      }
    },
    of(cardId) {
      if (total === 0) return null;
      const raw = (weighted.get(cardId) ?? 0) / total;
      return {
        value: raw / (raw + settings.halfValue),
        pairedWith: [...(links.get(cardId) ?? [])]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, PAIRED_WITH)
          .map(([id]) => id),
      };
    },
  };
}
