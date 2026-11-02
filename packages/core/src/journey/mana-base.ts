// packages/core/src/journey/mana-base.ts
import type { CardId } from '../contract';
import { isFrontLand } from '../scoring/curve';
import { COLOUR_ORDER } from './land-search';
import {
  BASIC_FETCH_PARTIAL_FROM_COLOURS,
  CHEAP_SOURCE_MAX_MANA_VALUE,
  CHEAP_SOURCE_MIN_SPELL_MANA_VALUE,
  CONSISTENCY_BASE_PCT,
  CONSISTENCY_TOP_MANA_VALUE,
  DORK_MIN_SPELL_MANA_VALUE,
  GOLD_EXTRA_SOURCES,
  KARSTEN_MAX_PIPS,
  KARSTEN_SOURCES_99,
  KEEP_MAX_LANDS,
  KEEP_MIN_LANDS,
  MANA_BY_TURN_CHECKS,
  OPENING_HAND_CARDS,
  SOURCE_CREDIT,
  THREE_SOURCE_MANA_VALUE,
  THREE_SOURCE_MIN_SPELL_MANA_VALUE,
} from './mana-base-thresholds';

/** Percent to share. */
const PCT = 100;
/** The odds cache is cleared past this many entries; keys are small integers, so it rarely fills. */
const ODDS_CACHE_MAX = 10_000;

/** What the mana base reads from a card (a TallyCard or CardSummary has all of it). */
export interface ManaCard {
  id: CardId;
  typeLine: string;
  manaValue: number;
  manaCost?: string | undefined;
  producedMana?: string | undefined;
  findsMana?: string | undefined;
  findsBasicOnly?: boolean | undefined;
}

export interface ManaEntry {
  card: ManaCard;
  quantity: number;
}

/** `pips` symbols any one of `colours` pays: one letter, or two for a hybrid pip. */
export interface PipNeed {
  colours: string;
  pips: number;
}

/** A castable half of a card: what it needs and the mana value it's cast at on curve. */
export interface CastingHalf {
  needs: PipNeed[];
  manaValue: number;
}

/** A colour's requirement: the card furthest under its Karsten number, and the deck's credited sources for it. */
export interface ColourNeed {
  colour: string;
  sources: number;
  needed: number;
  cardId: CardId;
  manaValue: number;
}

export interface HardToCast {
  cardId: CardId;
  chance: number;
  turn: number;
  target: number;
  commander: boolean;
}

export interface ManaBaseReport {
  colours: ColourNeed[];
  /** Cards under their 89 + M % target, worst first. */
  hardToCast: HardToCast[];
  byTurn: { turn: number; chance: number }[];
}

const byColourOrder = (a: string, b: string) => COLOUR_ORDER.indexOf(a) - COLOUR_ORDER.indexOf(b);
/** Letters in WUBRGC order, each once; anything else dropped. */
export const manaLetters = (letters: Iterable<string>): string =>
  [...new Set(letters)].filter((c) => c.length === 1 && COLOUR_ORDER.includes(c)).sort(byColourOrder).join('');

const faces = (typeLine: string) => typeLine.split(' // ');
const isBackLand = (typeLine: string) => !isFrontLand(typeLine) && faces(typeLine).slice(1).some((f) => /\bLand\b/.test(f));
const isCreature = (typeLine: string) => /\bCreature\b/.test(faces(typeLine)[0] ?? typeLine);
const isInstantOrSorcery = (typeLine: string) => /\b(Instant|Sorcery)\b/.test(faces(typeLine)[0] ?? typeLine);
/** The turn a spell is cast on curve. */
const turnOf = (manaValue: number) => Math.max(1, Math.floor(manaValue));

/** A cost's castable halves: coloured needs, and the half's mana value for split cards (the card's own otherwise). */
export function castingHalves(card: Pick<ManaCard, 'manaCost' | 'manaValue'>): CastingHalf[] {
  const cost = card.manaCost ?? '';
  if (cost === '') return [];
  const halves = cost.split(' // ');
  return halves
    .map((half) => {
      const needs = new Map<string, number>();
      let manaValue = 0;
      for (const [, symbol = ''] of half.matchAll(/\{([^}]+)\}/g)) {
        if (/^\d+$/.test(symbol)) {
          manaValue += Number(symbol);
          continue;
        }
        if (/^[XYZ]$/.test(symbol)) continue;
        manaValue += symbol.startsWith('2/') ? 2 : 1;
        // Phyrexian pips can be paid with life and {2/W} with generic mana: no colour needed.
        if (symbol.endsWith('/P') || symbol.startsWith('2/')) continue;
        const colours = manaLetters(symbol.split('/'));
        if (colours === '') continue;
        needs.set(colours, (needs.get(colours) ?? 0) + 1);
      }
      return {
        needs: [...needs].sort(([a], [b]) => byColourOrder(a[0]!, b[0]!)).map(([colours, pips]) => ({ colours, pips })),
        manaValue: halves.length === 1 ? card.manaValue : manaValue,
      };
    })
    .filter((h) => h.needs.length > 0);
}

/** The colours a card counts for: colourless always, coloured ones only inside the deck's colours. */
const usable = (letters: string | undefined, deckColours: string) => [...(letters ?? '')].filter((c) => c === 'C' || deckColours.includes(c));

/** Rocks and ramp: credit only for spells cast after them. */
const earlyCredit = (manaValue: number, spellManaValue: number, cheap: number, three: number) =>
  manaValue <= CHEAP_SOURCE_MAX_MANA_VALUE
    ? spellManaValue >= CHEAP_SOURCE_MIN_SPELL_MANA_VALUE
      ? cheap
      : 0
    : manaValue === THREE_SOURCE_MANA_VALUE && spellManaValue >= THREE_SOURCE_MIN_SPELL_MANA_VALUE
      ? three
      : 0;

/** Karsten's credit for one copy of `card` toward a need any of `colours` pays, for a spell of `spellManaValue`. */
export function sourceCredit(card: ManaCard, colours: string, spellManaValue: number, deckColours: string): number {
  const makes = usable(card.producedMana, deckColours).some((c) => colours.includes(c));
  const finds = usable(card.findsMana, deckColours).some((c) => colours.includes(c));
  if (!makes && !finds) return 0;
  if (isFrontLand(card.typeLine)) {
    const partial = !makes && card.findsBasicOnly === true && deckColours.length >= BASIC_FETCH_PARTIAL_FROM_COLOURS;
    return partial ? SOURCE_CREDIT.basicFetchManyColours : SOURCE_CREDIT.land;
  }
  if (isBackLand(card.typeLine)) return makes ? SOURCE_CREDIT.mdfcLand : 0;
  if (isInstantOrSorcery(card.typeLine) || !makes) {
    // Rituals make mana once: no credit. Ramp spells and land-finding permanents put a land down.
    return finds ? earlyCredit(card.manaValue, spellManaValue, SOURCE_CREDIT.cheapRamp, SOURCE_CREDIT.threeRamp) : 0;
  }
  if (isCreature(card.typeLine)) {
    return spellManaValue >= Math.max(DORK_MIN_SPELL_MANA_VALUE, card.manaValue + 1) ? SOURCE_CREDIT.dork : 0;
  }
  return earlyCredit(card.manaValue, spellManaValue, SOURCE_CREDIT.cheapRock, SOURCE_CREDIT.threeRock);
}

/** Karsten's sources for `pips` of one colour at `manaValue`, clamped to his table; one more for a gold card. */
export function sourcesNeeded(pips: number, manaValue: number, gold: boolean): number {
  const row = KARSTEN_SOURCES_99[Math.min(pips, KARSTEN_MAX_PIPS)]!;
  const listed = Object.keys(row)
    .map(Number)
    .sort((a, b) => a - b);
  const at = listed.filter((mv) => mv <= turnOf(manaValue)).at(-1) ?? listed[0]!;
  return row[at]! + (gold ? GOLD_EXTRA_SOURCES : 0);
}

/** Karsten's "consistently": 89 + M percent, M clamped to 1..7. */
export const consistencyTarget = (manaValue: number) =>
  (CONSISTENCY_BASE_PCT + Math.min(CONSISTENCY_TOP_MANA_VALUE, turnOf(manaValue))) / PCT;

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

interface Odds {
  kept: number;
  enough: number;
  cast: number;
}
const oddsCache = new Map<string, Odds>();

/**
 * Exact odds over every draw: a library of `library` cards with `pool` lands (or land-like sources), `sources` of them
 * of the needed colour. The opening 7 is kept with 2–5 pool cards; by turn `turn` the player has seen 7 + turn cards
 * (everyone draws on turn one in multiplayer). `kept`: P(keep). `enough`: P(keep and ≥ turn pool cards by then).
 * `cast`: P(that and ≥ `pips` sources).
 */
function drawOdds(library: number, poolIn: number, sourcesIn: number, turn: number, pips: number): Odds {
  const key = `${library},${poolIn},${sourcesIn},${turn},${pips}`;
  const cached = oddsCache.get(key);
  if (cached) return cached;
  const pool = Math.max(0, Math.min(poolIn, library));
  const sources = Math.max(0, Math.min(sourcesIn, pool));
  const other = pool - sources;
  const rest = library - pool;
  const hand = Math.min(OPENING_HAND_CARDS, library);
  const later = Math.min(turn, library - hand);
  const handWays = choose(library, hand);
  const laterWays = choose(library - hand, later);
  const odds: Odds = { kept: 0, enough: 0, cast: 0 };
  for (let s0 = 0; s0 <= Math.min(sources, hand); s0++) {
    for (let o0 = 0; o0 <= Math.min(other, hand - s0); o0++) {
      const r0 = hand - s0 - o0;
      if (r0 > rest || s0 + o0 < KEEP_MIN_LANDS || s0 + o0 > KEEP_MAX_LANDS) continue;
      const p0 = (choose(sources, s0) * choose(other, o0) * choose(rest, r0)) / handWays;
      odds.kept += p0;
      for (let s1 = 0; s1 <= Math.min(sources - s0, later); s1++) {
        for (let o1 = 0; o1 <= Math.min(other - o0, later - s1); o1++) {
          const r1 = later - s1 - o1;
          if (r1 > rest - r0) continue;
          const p = (p0 * choose(sources - s0, s1) * choose(other - o0, o1) * choose(rest - r0, r1)) / laterWays;
          if (s0 + o0 + s1 + o1 < turn) continue;
          odds.enough += p;
          if (s0 + s1 >= pips) odds.cast += p;
        }
      }
    }
  }
  if (oddsCache.size >= ODDS_CACHE_MAX) oddsCache.clear();
  oddsCache.set(key, odds);
  return odds;
}

/** P(≥ pips sources by turn `turn` | a kept hand and ≥ turn lands by then): Karsten's conditional, computed exactly. */
export function onCurveChance(library: number, pool: number, sources: number, turn: number, pips: number): number {
  const { enough, cast } = drawOdds(library, pool, sources, turn, pips);
  return enough > 0 ? Math.min(1, cast / enough) : 0;
}

/** P(≥ turn lands by turn `turn` | a kept hand). */
export function landsByTurnChance(library: number, pool: number, turn: number): number {
  const { kept, enough } = drawOdds(library, pool, 0, turn, 0);
  return kept > 0 ? Math.min(1, enough / kept) : 0;
}

/**
 * The mana base of a deck: per colour, its requirement and credited sources; cards under target, worst first; and
 * the chance of 3, 4 and 6 mana on time. Commanders are cast, never drawn: their needs count, their mana doesn't.
 */
export function manaBase(main: readonly ManaEntry[], commanders: readonly ManaCard[], deckColours: string): ManaBaseReport {
  const library = main.reduce((n, e) => n + e.quantity, 0);
  const sums = new Map<string, number>();
  /** Credited copies toward `colours` for a spell of `manaValue`; '' is the land pool (any colour, lands count 1). */
  const credited = (colours: string, manaValue: number) => {
    const key = `${colours}:${manaValue}`;
    const known = sums.get(key);
    if (known !== undefined) return known;
    const total = main.reduce((n, { card, quantity }) => {
      if (colours !== '') return n + sourceCredit(card, colours, manaValue, deckColours) * quantity;
      if (isFrontLand(card.typeLine) || isBackLand(card.typeLine)) return n + quantity;
      return n + sourceCredit(card, COLOUR_ORDER, manaValue, deckColours) * quantity;
    }, 0);
    sums.set(key, total);
    return total;
  };
  const halfChance = (half: CastingHalf) =>
    half.needs.reduce(
      (p, need) =>
        p *
        onCurveChance(
          library,
          Math.round(credited('', half.manaValue)),
          Math.round(credited(need.colours, half.manaValue)),
          turnOf(half.manaValue),
          need.pips,
        ),
      1,
    );

  const hardToCast: HardToCast[] = [];
  const worst = new Map<string, { need: ColourNeed; gap: number }>();
  const castable = [...main.map((e) => ({ card: e.card, commander: false })), ...commanders.map((c) => ({ card: c, commander: true }))];
  // A half needing a colour outside the deck's is off-identity, already flagged as illegal elsewhere: it isn't counted.
  const inColours = (half: CastingHalf) => half.needs.every((n) => usable(n.colours, deckColours).length > 0);
  for (const { card, commander } of castable) {
    const halves = castingHalves(card).filter(inColours);
    if (halves.length === 0) continue;
    const best = halves.map((half) => ({ half, chance: halfChance(half) })).reduce((a, b) => (b.chance > a.chance ? b : a));
    const target = consistencyTarget(best.half.manaValue);
    if (best.chance < target) hardToCast.push({ cardId: card.id, chance: best.chance, turn: turnOf(best.half.manaValue), target, commander });
    const gold = new Set(best.half.needs.flatMap((n) => [...n.colours])).size > 1;
    for (const need of best.half.needs) {
      if (need.colours.length !== 1) continue;
      const needed = sourcesNeeded(need.pips, best.half.manaValue, gold);
      const sources = credited(need.colours, best.half.manaValue);
      const gap = needed - sources;
      const held = worst.get(need.colours);
      if (!held || gap > held.gap) {
        worst.set(need.colours, { need: { colour: need.colours, sources, needed, cardId: card.id, manaValue: best.half.manaValue }, gap });
      }
    }
  }
  hardToCast.sort((a, b) => a.chance - b.chance || a.cardId - b.cardId);
  return {
    colours: [...worst.values()].map((w) => w.need).sort((a, b) => byColourOrder(a.colour, b.colour)),
    hardToCast,
    byTurn: MANA_BY_TURN_CHECKS.map((turn) => ({ turn, chance: landsByTurnChance(library, Math.round(credited('', turn)), turn) })),
  };
}
