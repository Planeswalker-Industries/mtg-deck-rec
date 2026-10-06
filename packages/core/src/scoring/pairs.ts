import { z } from 'zod';

/**
 * Card pairs (T064; docs/roadmap/card-graph-plan.md, "Statistics"): which cards decks run together, per commander key
 * and over the whole corpus. Counted in memory by the precompute worker and the evaluation alike, from these pure
 * functions.
 *
 * A pair's lift compares how many decks run both cards with how many would if they were unrelated, over the decks that
 * could have run both, and shrinks toward 1 ("no association") while the evidence is thin:
 *
 *   expected = n_a · n_b / n                    n: decks that could have run both; n_a, n_b: those running each card
 *   prior    = α · max(n_a, n_b) / n            α decks' worth of "no association", at the commoner card's rate
 *   lift     = (n_ab + prior) / (expected + prior)          pmi = ln(lift)
 *
 * which is the plan's P̂(B|A) = (n_ab + α·p̂(B)) / (n_a + α) over p̂(B), read from the rarer card toward the commoner,
 * made symmetric so one row serves both directions.
 *
 * Only positive associations are kept: support at least max(minSupport, minShare·decks), lift above `liftFloor`, and
 * the pair among either card's `maxPartners` strongest.
 */

const positive = z.number().positive();

/** `app_config.pairs` (private; the worker and the evaluation read it). */
export const pairSettingsSchema = z.object({
  /** α in the lift's shrinkage toward 1. */
  shrinkAlpha: positive,
  /** Fewest decks running both cards for a pair to be kept… */
  minSupport: z.int().min(1),
  /** …or this share of the key's decks, whichever is more. */
  minShare: z.number().min(0).max(1),
  /** Pairs at or under this lift are dropped. */
  liftFloor: positive,
  /** A pair is kept when it is among either card's this many strongest. */
  maxPartners: z.int().min(1),
  /** The global count covers cards in at least this many decks (its counter is dense over them). */
  globalMinDecks: z.int().min(1),
});

export type PairSettings = z.infer<typeof pairSettingsSchema>;

/** `app_config.pairs`, validated. Throws on a missing or malformed value. */
export function parsePairSettings(value: unknown): PairSettings {
  const parsed = pairSettingsSchema.safeParse(value);
  if (!parsed.success) throw new Error(`app_config.pairs is missing or malformed: ${parsed.error.message}`);
  return parsed.data;
}

/** One kept pair: `cardA` < `cardB`. */
export interface PairRow {
  cardA: number;
  cardB: number;
  /** Decks running both. */
  pairDecks: number;
  lift: number;
}

/** A pair's lift, shrunk toward 1 by α decks at the commoner card's rate. */
export function pairLift(pairDecks: number, decksA: number, decksB: number, decks: number, alpha: number): number {
  const expected = (decksA * decksB) / decks;
  const prior = (alpha * Math.max(decksA, decksB)) / decks;
  return (pairDecks + prior) / (expected + prior);
}

/** Numeric key for a pair of card ids (both under 2^21), a < b. */
const PAIR_KEY_BASE = 2 ** 21;
const pairKey = (a: number, b: number) => a * PAIR_KEY_BASE + b;

/** Keeps each pair that is among either card's `maxPartners` strongest (by lift, then support, then ids). */
export function topPartners(rows: readonly PairRow[], maxPartners: number): PairRow[] {
  const byCard = new Map<number, PairRow[]>();
  const add = (card: number, r: PairRow) => {
    const list = byCard.get(card);
    if (list) list.push(r);
    else byCard.set(card, [r]);
  };
  for (const r of rows) {
    add(r.cardA, r);
    add(r.cardB, r);
  }
  const kept = new Set<PairRow>();
  const order = (x: PairRow, y: PairRow) => y.lift - x.lift || y.pairDecks - x.pairDecks || x.cardA - y.cardA || x.cardB - y.cardB;
  for (const list of byCard.values()) for (const r of list.sort(order).slice(0, maxPartners)) kept.add(r);
  return [...kept].sort((x, y) => x.cardA - y.cardA || x.cardB - y.cardB);
}

/** A deck as one key's pair count reads it. */
export interface KeyPairDeck {
  /** Distinct non-basic card ids. */
  cardIds: readonly number[];
  /** 'YYYY-MM' it was last updated. */
  month: string;
}

/**
 * One commander key's pairs. Release-aware like its play rates: a pair's decks are those updated in or after the later
 * of the two cards' release months (`releaseMonth`; unknown counts as always out).
 */
export function keyPairs(decks: readonly KeyPairDeck[], releaseMonth: (cardId: number) => string | null, settings: PairSettings): PairRow[] {
  const support = Math.max(settings.minSupport, Math.ceil(settings.minShare * decks.length));
  const cardDecks = new Map<number, number>();
  for (const d of decks) for (const id of d.cardIds) cardDecks.set(id, (cardDecks.get(id) ?? 0) + 1);
  const frequent = (id: number) => (cardDecks.get(id) ?? 0) >= support;

  // Decks and each frequent card's decks by month, for the counts after a release month.
  const deckMonths = new Map<string, number>();
  const cardMonths = new Map<number, Map<string, number>>();
  const pairs = new Map<number, number>();
  for (const d of decks) {
    deckMonths.set(d.month, (deckMonths.get(d.month) ?? 0) + 1);
    const ids = d.cardIds.filter(frequent).sort((a, b) => a - b);
    for (const id of ids) {
      let months = cardMonths.get(id);
      if (!months) cardMonths.set(id, (months = new Map()));
      months.set(d.month, (months.get(d.month) ?? 0) + 1);
    }
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i] as number;
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(a, ids[j] as number);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const since = (months: ReadonlyMap<string, number> | undefined, from: string | null) => {
    let n = 0;
    for (const [m, count] of months ?? []) if (from === null || m >= from) n += count;
    return n;
  };
  const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

  const rows: PairRow[] = [];
  for (const [key, pairDecks] of pairs) {
    if (pairDecks < support) continue;
    const cardA = Math.floor(key / PAIR_KEY_BASE);
    const cardB = key % PAIR_KEY_BASE;
    const from = later(releaseMonth(cardA), releaseMonth(cardB));
    const n = since(deckMonths, from);
    if (n === 0) continue;
    const lift = pairLift(pairDecks, since(cardMonths.get(cardA), from), since(cardMonths.get(cardB), from), n, settings.shrinkAlpha);
    if (lift > settings.liftFloor) rows.push({ cardA, cardB, pairDecks, lift });
  }
  return topPartners(rows, settings.maxPartners);
}

/** A deck as the global pair count reads it. */
export interface GlobalPairDeck {
  cardIds: readonly number[];
  /** The deck's colour identity bitmask (0–31). */
  identity: number;
}

/** Colour identities: five colours, every combination. */
const IDENTITIES = 32;

/**
 * Pairs over the whole corpus, for commanders with few decks of their own. A pair's decks are those whose colour
 * identity allows both cards, as the baseline counts a card. The counter is dense over the cards in at least
 * `globalMinDecks` decks (a triangle of 32-bit counts: about 380 MB for 14,000 cards).
 */
export function globalPairs(decks: readonly GlobalPairDeck[], cardIdentity: (cardId: number) => number, settings: PairSettings): PairRow[] {
  const cardDecks = new Map<number, number>();
  for (const d of decks) for (const id of d.cardIds) cardDecks.set(id, (cardDecks.get(id) ?? 0) + 1);
  const cards = [...cardDecks].filter(([, n]) => n >= settings.globalMinDecks).map(([id]) => id).sort((a, b) => a - b);
  const rank = new Map(cards.map((id, i) => [id, i]));
  const m = cards.length;
  const rowStart = (i: number) => i * m - (i * (i + 1)) / 2;
  const cell = (i: number, j: number) => rowStart(i) + (j - i - 1);
  const counts = new Uint32Array(Math.max(0, (m * (m - 1)) / 2));
  const deckByIdentity = new Float64Array(IDENTITIES);
  const cardByIdentity = new Uint32Array(m * IDENTITIES);

  for (const d of decks) {
    deckByIdentity[d.identity] = (deckByIdentity[d.identity] ?? 0) + 1;
    const ranks = d.cardIds.flatMap((id) => {
      const r = rank.get(id);
      return r === undefined ? [] : [r];
    }).sort((a, b) => a - b);
    for (let x = 0; x < ranks.length; x++) {
      const i = ranks[x] as number;
      cardByIdentity[i * IDENTITIES + d.identity] = (cardByIdentity[i * IDENTITIES + d.identity] ?? 0) + 1;
      for (let y = x + 1; y < ranks.length; y++) {
        const c = cell(i, ranks[y] as number);
        counts[c] = (counts[c] ?? 0) + 1;
      }
    }
  }

  // Decks (and a card's decks) whose identity contains a mask, for every mask.
  const supersets = Array.from({ length: IDENTITIES }, (_, u) => [...Array(IDENTITIES).keys()].filter((mask) => (mask & u) === u));
  const decksAllowing = supersets.map((list) => list.reduce((n, mask) => n + (deckByIdentity[mask] ?? 0), 0));
  const cardDecksAllowing = (i: number, u: number) => (supersets[u] ?? []).reduce((n, mask) => n + (cardByIdentity[i * IDENTITIES + mask] ?? 0), 0);

  const rows: PairRow[] = [];
  for (let i = 0; i < m; i++) {
    const start = rowStart(i);
    for (let j = i + 1; j < m; j++) {
      const pairDecks = counts[start + (j - i - 1)] ?? 0;
      if (pairDecks < settings.minSupport) continue;
      const cardA = cards[i] as number;
      const cardB = cards[j] as number;
      const u = cardIdentity(cardA) | cardIdentity(cardB);
      const n = decksAllowing[u] ?? 0;
      if (n === 0) continue;
      const lift = pairLift(pairDecks, cardDecksAllowing(i, u), cardDecksAllowing(j, u), n, settings.shrinkAlpha);
      if (lift > settings.liftFloor) rows.push({ cardA, cardB, pairDecks, lift });
    }
  }
  return topPartners(rows, settings.maxPartners);
}
