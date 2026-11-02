// packages/core/src/journey/deck-tally.ts
import type { Bracket, BracketSignals, CardId, CardSummary, ComboRef, DeckCombo, StatTargets } from '../contract';
import { fitsBracket, type BracketRules } from '../formats/commander/bracket';
import { curveBucket, isFrontLand, isStatCardType, statCardType } from '../scoring/curve';
import { isBasicLand } from './builder';
import { CURVE_TOP_MANA_VALUE } from './deck-stats';
import { manaBase, manaLetters, sourceCredit, type ManaBaseReport } from './mana-base';

/** Colour row labels. */
const COLOUR_NAMES: Readonly<Record<string, string>> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };
/** Preview deltas for colour rows show tenths (a Signet is +0.8, not +0.75). */
const DELTA_TENTHS = 10;

/** A stat is in line within this share of its target (owner, 2026-10-08). */
export const STAT_TOLERANCE_SHARE = 0.2;
/** …or within this many cards, so small targets (0.4 planeswalkers, 0.08 at mana value 0) can pass (owner, 2026-10-08). */
export const STAT_TOLERANCE_MIN_CARDS = 1;
/** At or above this share of stats in line the deck reads Mild rather than Urgent (owner, 2026-10-08). */
export const STAT_MILD_SHARE = 0.5;

/** What the tally reads from a card. */
export interface TallyCard {
  id: CardId;
  typeLine: string;
  manaValue: number;
  gameChanger: boolean;
  /** The tracked role ids the card fills (`deck_role_targets`). */
  roles: readonly string[];
  manaCost?: string | undefined;
  producedMana?: string | undefined;
  findsMana?: string | undefined;
  findsBasicOnly?: boolean | undefined;
  /** Commanders only: the deck's colours come from theirs. */
  colorIdentity?: string | undefined;
}

export interface TallyEntry {
  card: TallyCard;
  quantity: number;
}

/**
 * A deck's counts, changed card by card. Commanders count toward Game Changers and the bracket, never toward the
 * main deck's lands, curve, types or roles (the corpus profiles count the 99 the same way).
 */
export interface DeckTally {
  cards: number;
  lands: number;
  basicLands: number;
  /** Copies per tracked role id. */
  roles: Map<string, number>;
  /** Nonland copies per mana value, index = mana value, the last bar CURVE_TOP_MANA_VALUE and up. */
  curve: number[];
  /** Nonland copies per counted card type (`statCardType`). */
  types: Map<string, number>;
  gameChangers: number;
  /** The main deck as the tally last saw it: what `syncTally` diffs against. */
  main: Map<CardId, TallyEntry>;
  commanderIds: Set<CardId>;
  /** The commanders as passed in: their costs count toward the mana base, their mana doesn't. */
  commanders: TallyCard[];
}

export const toTallyCard = (card: CardSummary, roles: readonly string[]): TallyCard => ({
  id: card.id,
  typeLine: card.typeLine,
  manaValue: card.manaValue,
  gameChanger: card.gameChanger,
  roles,
  manaCost: card.manaCost,
  producedMana: card.producedMana,
  findsMana: card.findsMana,
  findsBasicOnly: card.findsBasicOnly,
  colorIdentity: card.colorIdentity,
});

export const withinTolerance = (value: number, target: number): boolean =>
  Math.abs(value - target) <= Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);

const emptyTally = (): DeckTally => ({
  cards: 0,
  lands: 0,
  basicLands: 0,
  roles: new Map(),
  curve: Array.from({ length: CURVE_TOP_MANA_VALUE + 1 }, () => 0),
  types: new Map(),
  gameChangers: 0,
  main: new Map(),
  commanderIds: new Set(),
  commanders: [],
});

/** Moves the counts by `quantity` copies of a card (negative to take them out). Mutates `tally`. */
export function applyCard(tally: DeckTally, card: TallyCard, quantity: number): void {
  if (quantity === 0) return;
  const held = (tally.main.get(card.id)?.quantity ?? 0) + quantity;
  if (held > 0) tally.main.set(card.id, { card, quantity: held });
  else tally.main.delete(card.id);
  tally.cards += quantity;
  if (isFrontLand(card.typeLine)) {
    tally.lands += quantity;
    if (isBasicLand(card)) tally.basicLands += quantity;
  } else {
    const bar = Number(curveBucket(card.manaValue));
    tally.curve[bar] = (tally.curve[bar] ?? 0) + quantity;
    const type = statCardType(card.typeLine);
    if (type) tally.types.set(type, (tally.types.get(type) ?? 0) + quantity);
  }
  for (const role of card.roles) tally.roles.set(role, (tally.roles.get(role) ?? 0) + quantity);
  if (card.gameChanger) tally.gameChangers += quantity;
}

/** A full count: only when the deck the round starts from changes (a new analysis). */
export function buildTally(main: readonly TallyEntry[], commanders: readonly TallyCard[]): DeckTally {
  const tally = emptyTally();
  for (const { card, quantity } of main) applyCard(tally, card, quantity);
  for (const c of commanders) {
    tally.commanderIds.add(c.id);
    tally.commanders.push(c);
    if (c.gameChanger) tally.gameChangers++;
  }
  return tally;
}

/**
 * Brings the tally to `main` by the cards whose quantity moved: the deck's ids are compared, and only a changed card's
 * counts are touched. Mutates `tally`.
 */
export function syncTally(tally: DeckTally, main: readonly TallyEntry[]): void {
  const next = new Map(main.map((e) => [e.card.id, e]));
  for (const [id, held] of [...tally.main]) {
    if (!next.has(id)) applyCard(tally, held.card, -held.quantity);
  }
  for (const [id, entry] of next) {
    const delta = entry.quantity - (tally.main.get(id)?.quantity ?? 0);
    applyCard(tally, entry.card, delta);
  }
}

export interface BracketInput {
  chosen: Bracket;
  /** The analysis's signals: its mass land denial and extra-turn lists are checked against the cards still in the deck. */
  signals: BracketSignals;
  combos: readonly DeckCombo[];
  /**
   * Cards added this round whose suggestion completed a combo above the bracket then, with those combos. Each counts
   * against the chosen bracket while one of its combos is still over it, so raising the bracket clears it.
   */
  overBracketAdds: ReadonlyMap<CardId, readonly ComboRef[]>;
}

export type StatGroup = 'mana' | 'roles' | 'types' | 'colours';

export interface StatLine {
  /** 'lands', 'basicLands', a role id, a card type ('creature') or a colour's sources ('sources:B'). */
  key: string;
  group: StatGroup;
  label: string;
  value: number;
  target: number;
  ok: boolean;
  /** The value when the round started: the faint tick on the bar. */
  start: number;
  /** Colour rows: what a card's credit is measured against, for preview deltas. */
  sourceFor?: { colour: string; manaValue: number; deckColours: string };
}

export interface CurveBar {
  manaValue: number;
  value: number;
  target: number;
  ok: boolean;
  start: number;
}

export type DeckStatsLevel = 'ok' | 'mild' | 'urgent';

export interface DeckStatsReport {
  label: string;
  stats: StatLine[];
  curve: { ok: boolean; bars: CurveBar[] };
  bracket: { ok: boolean; chosen: Bracket; combos: DeckCombo[] };
  okCount: number;
  total: number;
  level: DeckStatsLevel;
  /** The mana base beyond the colour rows (which are in `stats`): cards under target and mana by turn. */
  mana: Pick<ManaBaseReport, 'hardToCast' | 'byTurn'>;
}

const inDeck = (tally: DeckTally, id: CardId) => tally.main.has(id) || tally.commanderIds.has(id);

function bracketFits(tally: DeckTally, targets: StatTargets, input: BracketInput): { ok: boolean; combos: DeckCombo[] } {
  const combos = input.combos.filter((c) => c.pieceIds.every((id) => inDeck(tally, id)));
  const checked = combos.filter((c) => c.alsoNeeded.length === 0);
  const limits = targets.bracketLimits;
  const comboBracket = checked.reduce<number | null>((max, c) => Math.max(max ?? 0, c.minBracket), null);
  const signals: BracketSignals = {
    gameChangerCount: tally.gameChangers,
    massLandDenialIds: input.signals.massLandDenialIds.filter((id) => inDeck(tally, id)),
    extraTurnIds: input.signals.extraTurnIds.filter((id) => inDeck(tally, id)),
    comboBracket: comboBracket === null ? null : (comboBracket as Bracket),
    extraTurnLoop: checked.some((c) => c.results.some((r) => limits.extraTurnLoopResults.includes(r))),
  };
  // fitsBracket reads only the limits; the tag ids are how the server found the cards, already done.
  const rules: BracketRules = { ...limits, massLandDenialTagIds: [], extraTurnTagIds: [] };
  // As the server's overBracket reads a combo: above its minimum, or an extra-turn loop the bracket forbids.
  const comboOver = (c: ComboRef) =>
    c.minBracket > input.chosen ||
    (input.chosen < limits.extraTurnLoopFromBracket && c.results.some((r) => limits.extraTurnLoopResults.includes(r)));
  const overBracketAdd = [...input.overBracketAdds].some(([id, refs]) => inDeck(tally, id) && refs.some(comboOver));
  return { ok: fitsBracket(signals, input.chosen, rules) && !overBracketAdd, combos };
}

function statLines(tally: DeckTally, targets: StatTargets): Omit<StatLine, 'start'>[] {
  const line = (key: string, group: StatGroup, label: string, value: number, target: number) => ({
    key,
    group,
    label,
    value,
    target,
    ok: withinTolerance(value, target),
  });
  return [
    line('lands', 'mana', 'Lands', tally.lands, targets.lands),
    line('basicLands', 'mana', 'Basic lands', tally.basicLands, targets.basicLands),
    ...targets.roles.map((r) => line(r.roleId, 'roles', r.label, tally.roles.get(r.roleId) ?? 0, r.target)),
    ...targets.types.map((t) => line(t.cardType, 'types', t.label, tally.types.get(t.cardType) ?? 0, t.target)),
  ];
}

const deckColoursOf = (tally: DeckTally) => manaLetters(tally.commanders.flatMap((c) => [...(c.colorIdentity ?? '')]));
const manaOf = (tally: DeckTally) => manaBase([...tally.main.values()], tally.commanders, deckColoursOf(tally));

function colourLines(mana: ManaBaseReport, start: ManaBaseReport, deckColours: string): StatLine[] {
  return mana.colours.map((need) => ({
    key: `sources:${need.colour}`,
    group: 'colours' as const,
    label: `${COLOUR_NAMES[need.colour] ?? need.colour} sources`,
    value: Math.floor(need.sources),
    target: need.needed,
    // A minimum, not a band: more sources are never a problem.
    ok: need.sources >= need.needed,
    start: Math.floor(start.colours.find((s) => s.colour === need.colour)?.sources ?? need.sources),
    sourceFor: { colour: need.colour, manaValue: need.manaValue, deckColours },
  }));
}

/**
 * Grades the tally against the targets. The mana base reads the deck once per report (about a hundred cards; the
 * odds are cached); everything else is about twenty comparisons.
 */
export function gradeDeck(tally: DeckTally, targets: StatTargets, bracket: BracketInput, start: DeckTally = tally): DeckStatsReport {
  const startLines = new Map(statLines(start, targets).map((s) => [s.key, s.value]));
  const mana = manaOf(tally);
  const stats = [
    ...statLines(tally, targets).map((s) => ({ ...s, start: startLines.get(s.key) ?? s.value })),
    ...colourLines(mana, start === tally ? mana : manaOf(start), deckColoursOf(tally)),
  ];
  const bars = targets.curve.map((target, manaValue) => {
    const value = tally.curve[manaValue] ?? 0;
    return { manaValue, value, target, ok: withinTolerance(value, target), start: start.curve[manaValue] ?? 0 };
  });
  const curve = { ok: bars.every((b) => b.ok), bars };
  const fit = bracketFits(tally, targets, bracket);
  const okCount = stats.filter((s) => s.ok).length + (curve.ok ? 1 : 0) + (fit.ok ? 1 : 0);
  const total = stats.length + 2;
  const level: DeckStatsLevel = okCount === total ? 'ok' : okCount >= total * STAT_MILD_SHARE ? 'mild' : 'urgent';
  return {
    label: targets.label,
    stats,
    curve,
    bracket: { ok: fit.ok, chosen: bracket.chosen, combos: fit.combos },
    okCount,
    total,
    level,
    mana: { hardToCast: mana.hardToCast, byTurn: mana.byTurn },
  };
}

/**
 * One tally per base (the analysis object): a new base is counted in full once, and every later call only applies
 * what moved. `start` is the deck the round started from, counted on a new base for the ticks on the bars; it is never
 * taken from `main`, since a base can change mid-round (a finished deck lookup re-reads the same deck). Without it the
 * start is the tally itself, so no ticks show (the Deckbuilder has no rounds).
 */
export function tallyCache() {
  let base: object | null = null;
  let tally: DeckTally | null = null;
  let start: DeckTally | null = null;
  return {
    report(
      nextBase: object,
      main: readonly TallyEntry[],
      commanders: readonly TallyCard[],
      targets: StatTargets,
      bracket: BracketInput,
      startEntries?: readonly TallyEntry[],
    ): DeckStatsReport {
      if (nextBase !== base || !tally) {
        base = nextBase;
        tally = buildTally(main, commanders);
        start = startEntries ? buildTally(startEntries, commanders) : null;
      } else {
        syncTally(tally, main);
      }
      return gradeDeck(tally, targets, bracket, start ?? tally);
    },
  };
}

/**
 * How each stat line would move if `add` went into the deck and `remove` came out: +1 for a role, land or card type
 * count the incoming card adds to, -1 for one the outgoing card takes from; for a colour row, the difference in source
 * credit, in tenths. Lines that wouldn't move are left out. Deck stats shows these beside the counts while a card is on
 * screen, so the player sees what answering it does.
 */
export function statDeltas(
  lines: readonly Pick<StatLine, 'key' | 'sourceFor'>[],
  add: TallyCard | null,
  remove: TallyCard | null,
): Map<string, number> {
  const counts = (card: TallyCard | null, key: string): number => {
    if (!card) return 0;
    if (key === 'lands') return isFrontLand(card.typeLine) ? 1 : 0;
    if (key === 'basicLands') return isFrontLand(card.typeLine) && isBasicLand(card) ? 1 : 0;
    if (isStatCardType(key)) return statCardType(card.typeLine) === key ? 1 : 0;
    return card.roles.includes(key) ? 1 : 0;
  };
  const deltas = new Map<string, number>();
  const credit = (card: TallyCard | null, on: NonNullable<StatLine['sourceFor']>) =>
    card ? sourceCredit(card, on.colour, on.manaValue, on.deckColours) : 0;
  for (const { key, sourceFor } of lines) {
    const delta = sourceFor
      ? Math.round((credit(add, sourceFor) - credit(remove, sourceFor)) * DELTA_TENTHS) / DELTA_TENTHS
      : counts(add, key) - counts(remove, key);
    if (delta !== 0) deltas.set(key, delta);
  }
  return deltas;
}
