// packages/core/src/journey/deck-tally.ts
import type { Bracket, BracketSignals, CardId, CardSummary, ComboRef, DeckCombo, StatChoices, StatTargets } from '../contract';
import { fitsBracket, type BracketRules } from '../formats/commander/bracket';
import { curveBucket, isFrontLand, isStatCardType, statCardType } from '../scoring/curve';
import { isBasicLand } from './builder';
import { CURVE_TOP_MANA_VALUE } from './deck-stats';
import { colourTarget, creditedSources, manaBase, manaLetters, type ManaBaseReport, type ManaDeck, type ManaEntry } from './mana-base';

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
  layout?: string | undefined;
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
  layout: card.layout,
  colorIdentity: card.colorIdentity,
});

export const withinTolerance = (value: number, target: number): boolean =>
  Math.abs(value - target) <= Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);

/** A line short of its target by more than the tolerance: what Deck stats, Add's pills and the build page call short. */
export const shortOfTarget = (line: { value: number; target: number }): boolean =>
  line.value < line.target && !withinTolerance(line.value, line.target);

/** Whole cards a line is short of its target as shown (the target rounds for display). */
export const cardsShort = (line: { value: number; target: number }): number => Math.max(0, Math.round(line.target) - line.value);

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

/** A copy of a tally that can be moved without touching the original. */
export const cloneTally = (tally: DeckTally): DeckTally => ({
  ...tally,
  roles: new Map(tally.roles),
  curve: [...tally.curve],
  types: new Map(tally.types),
  main: new Map(tally.main),
  commanderIds: new Set(tally.commanderIds),
  commanders: [...tally.commanders],
});

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

/**
 * How a line counts toward the score: in line, off, or left out because the player chose to ignore it (`StatChoices`).
 * An ignored line shows grey and is in neither `okCount` nor `total`.
 */
export type StatState = 'ok' | 'off' | 'ignored';

/** The curve's key in `StatChoices`: its bars read as one line. */
export const CURVE_LINE = 'curve';

/** The bracket's key among the lines a move can flip (`stateFlips`). It can't be ignored. */
export const BRACKET_LINE = 'bracket';

export interface StatLine {
  /** 'lands', 'basicLands', a role id, a card type ('creature') or a colour's sources ('sources:B'). */
  key: string;
  group: StatGroup;
  label: string;
  value: number;
  target: number;
  /** Whether the value is in line with the target, whatever the player chose for the line. */
  ok: boolean;
  /** What the score counts: `ok` as it stands, or 'ignored'. */
  state: StatState;
  /** The value when the round started: the faint tick on the bar. */
  start: number;
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
  curve: { ok: boolean; state: StatState; bars: CurveBar[] };
  bracket: { ok: boolean; chosen: Bracket; combos: DeckCombo[] };
  okCount: number;
  total: number;
  level: DeckStatsLevel;
  /**
   * The mana base beyond the colour rows (which are in `stats`): cards under target and mana by turn, and the deck it
   * was read from, which `statDeltas` reads again with the card on screen in or out.
   */
  mana: Pick<ManaBaseReport, 'hardToCast' | 'byTurn'> & { deck: ManaDeck };
}

/**
 * Whether moving a line by `delta`, its target becoming `targetAfter`, brings it closer to the target; for a `minimum`
 * line (colour sources), whether it ends further above it.
 */
export const towardTarget = (value: number, target: number, delta: number, minimum = false, targetAfter = target): boolean =>
  minimum
    ? value + delta - targetAfter > value - target
    : Math.abs(value + delta - targetAfter) < Math.abs(value - target);

const inDeck = (tally: DeckTally, id: CardId) => tally.main.has(id) || tally.commanderIds.has(id);

/** No line ignored. */
const NO_CHOICES: StatChoices = {};

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

function statLines(tally: DeckTally, targets: StatTargets): Omit<StatLine, 'start' | 'state'>[] {
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
const colourKey = (colour: string) => `sources:${colour}`;

/** The colour rows. The start tick is the start deck measured against today's requirement, so the two compare. */
function colourLines(mana: ManaBaseReport, start: readonly ManaEntry[] | null, deckColours: string, cap: number | null): Omit<StatLine, 'state'>[] {
  return mana.colours.map((need) => {
    const value = Math.floor(need.sources);
    const target = colourTarget(need.needed, cap);
    return {
      key: colourKey(need.colour),
      group: 'colours' as const,
      label: `${COLOUR_NAMES[need.colour] ?? need.colour} sources`,
      value,
      target,
      // A minimum, not a band: more sources are never a problem.
      ok: need.sources >= target,
      start: start ? Math.floor(creditedSources(start, need.colour, need.manaValue, deckColours)) : value,
    };
  });
}

/**
 * Grades the tally against the targets. The mana base reads the deck once per report (about a hundred cards; the
 * odds are cached) and the start deck once per colour row; everything else is about twenty comparisons. A line the
 * player chose to ignore (`choices`) is graded as ever and left out of the score; the bracket can't be ignored.
 */
export function gradeDeck(
  tally: DeckTally,
  targets: StatTargets,
  bracket: BracketInput,
  start: DeckTally = tally,
  choices: StatChoices = NO_CHOICES,
): DeckStatsReport {
  const stateOf = (key: string, ok: boolean): StatState => (choices[key] === 'ignore' ? 'ignored' : ok ? 'ok' : 'off');
  const startLines = new Map(statLines(start, targets).map((s) => [s.key, s.value]));
  const deck: ManaDeck = {
    main: [...tally.main.values()],
    commanders: [...tally.commanders],
    deckColours: deckColoursOf(tally),
    colourSourceCap: targets.colourSourceCap ?? null,
  };
  const mana = manaBase(deck.main, deck.commanders, deck.deckColours);
  const stats: StatLine[] = [
    ...statLines(tally, targets).map((s) => ({ ...s, start: startLines.get(s.key) ?? s.value })),
    ...colourLines(mana, start === tally ? null : [...start.main.values()], deck.deckColours, deck.colourSourceCap ?? null),
  ].map((s) => ({ ...s, state: stateOf(s.key, s.ok) }));
  const bars = targets.curve.map((target, manaValue) => {
    const value = tally.curve[manaValue] ?? 0;
    return { manaValue, value, target, ok: withinTolerance(value, target), start: start.curve[manaValue] ?? 0 };
  });
  const curveOk = bars.every((b) => b.ok);
  const curve = { ok: curveOk, state: stateOf(CURVE_LINE, curveOk), bars };
  const fit = bracketFits(tally, targets, bracket);
  const counted = [...stats.map((s) => s.state), curve.state].filter((state) => state !== 'ignored');
  const okCount = counted.filter((state) => state === 'ok').length + (fit.ok ? 1 : 0);
  // The counted lines, and the bracket.
  const total = counted.length + 1;
  const level: DeckStatsLevel = okCount === total ? 'ok' : okCount >= total * STAT_MILD_SHARE ? 'mild' : 'urgent';
  return {
    label: targets.label,
    stats,
    curve,
    bracket: { ok: fit.ok, chosen: bracket.chosen, combos: fit.combos },
    okCount,
    total,
    level,
    mana: { hardToCast: mana.hardToCast, byTurn: mana.byTurn, deck },
  };
}

/** One copy of a card in, one out, or both: a card on screen answered, or a Fix move. */
export interface TallyMove {
  in: TallyCard | null;
  out: TallyCard | null;
}

/**
 * The deck graded with `moves` made, on a copy of the tally: what the Deck stats footer and panel preview for the card
 * on screen, and the auto-fix preview for the moves selected. Graded in full, so the curve and the colour rows count
 * exactly. Its `start` values are the moved deck itself, not the round's start: read the lines' values and states only.
 */
export function reportWithMoves(
  tally: DeckTally,
  targets: StatTargets,
  bracket: BracketInput,
  choices: StatChoices,
  moves: readonly TallyMove[],
): DeckStatsReport {
  const next = cloneTally(tally);
  for (const move of moves) {
    if (move.in) applyCard(next, move.in, 1);
    // The deck's own copy goes out, so its roles are the ones it was counted with.
    if (move.out) applyCard(next, next.main.get(move.out.id)?.card ?? move.out, -1);
  }
  return gradeDeck(next, targets, bracket, next, choices);
}

/** The score with `moves` made (`reportWithMoves`). */
export function scoreWithMoves(
  tally: DeckTally,
  targets: StatTargets,
  bracket: BracketInput,
  choices: StatChoices,
  moves: readonly TallyMove[],
): Pick<DeckStatsReport, 'okCount' | 'total' | 'level'> {
  const { okCount, total, level } = reportWithMoves(tally, targets, bracket, choices, moves);
  return { okCount, total, level };
}

/**
 * The lines that count toward the score and change state between two grades of a deck, with the state each ends in:
 * stat lines by key, the curve as `CURVE_LINE`, the bracket as `BRACKET_LINE`. Ignored lines count in neither, so each
 * flip to 'ok' is one more in line and each to 'off' one fewer: together they explain `after.okCount - before.okCount`.
 */
export function stateFlips(before: DeckStatsReport, after: DeckStatsReport): Map<string, 'ok' | 'off'> {
  const flips = new Map<string, 'ok' | 'off'>();
  const note = (key: string, from: StatState, to: StatState) => {
    if (from !== to && from !== 'ignored' && to !== 'ignored') flips.set(key, to);
  };
  const afterStates = new Map(after.stats.map((s) => [s.key, s.state]));
  for (const stat of before.stats) {
    const to = afterStates.get(stat.key);
    if (to) note(stat.key, stat.state, to);
  }
  note(CURVE_LINE, before.curve.state, after.curve.state);
  note(BRACKET_LINE, before.bracket.ok ? 'ok' : 'off', after.bracket.ok ? 'ok' : 'off');
  return flips;
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
      choices?: StatChoices,
    ): DeckStatsReport {
      if (nextBase !== base || !tally) {
        base = nextBase;
        tally = buildTally(main, commanders);
        start = startEntries ? buildTally(startEntries, commanders) : null;
      } else {
        syncTally(tally, main);
      }
      return gradeDeck(tally, targets, bracket, start ?? tally, choices);
    },
  };
}

/** How a line would move with the card on screen answered; `target` is set on a colour row whose requirement moves. */
export interface StatDelta {
  delta: number;
  target?: number;
}

/** The deck with one copy of `add` in and one of `remove` out. */
function withSwap(main: readonly ManaEntry[], add: TallyCard | null, remove: TallyCard | null): ManaEntry[] {
  const next = new Map(main.map((e) => [e.card.id, e]));
  const move = (card: TallyCard, quantity: number) => {
    const held = (next.get(card.id)?.quantity ?? 0) + quantity;
    if (held > 0) next.set(card.id, { card, quantity: held });
    else next.delete(card.id);
  };
  if (add) move(add, 1);
  if (remove) move(remove, -1);
  return [...next.values()];
}

/** A report's mana base kept by its deck, so a preview reads the deck once per report rather than once per card. */
const manaOfDeck = new WeakMap<ManaDeck, ManaBaseReport>();
const manaBaseOf = (deck: ManaDeck): ManaBaseReport => {
  const known = manaOfDeck.get(deck);
  if (known) return known;
  const mana = manaBase(deck.main, deck.commanders, deck.deckColours);
  manaOfDeck.set(deck, mana);
  return mana;
};

/**
 * How each stat line would move if `add` went into the deck and `remove` came out: +1 for a role, land or card type
 * count the incoming card adds to, -1 for one the outgoing card takes from. Colour rows need the report's `deck`: the
 * mana base is read again with the card in or out, so a card that becomes (or stops being) the hardest to cast moves
 * the target too; their deltas are in tenths (a Signet is +0.8, not +0.75). Lines that wouldn't move are left out.
 * Deck stats shows these beside the counts while a card is on screen, so the player sees what answering it does.
 */
export function statDeltas(
  lines: readonly Pick<StatLine, 'key' | 'group'>[],
  add: TallyCard | null,
  remove: TallyCard | null,
  deck?: ManaDeck,
): Map<string, StatDelta> {
  const counts = (card: TallyCard | null, key: string): number => {
    if (!card) return 0;
    if (key === 'lands') return isFrontLand(card.typeLine) ? 1 : 0;
    if (key === 'basicLands') return isFrontLand(card.typeLine) && isBasicLand(card) ? 1 : 0;
    if (isStatCardType(key)) return statCardType(card.typeLine) === key ? 1 : 0;
    return card.roles.includes(key) ? 1 : 0;
  };
  const deltas = new Map<string, StatDelta>();
  for (const { key, group } of lines) {
    if (group === 'colours') continue;
    const delta = counts(add, key) - counts(remove, key);
    if (delta !== 0) deltas.set(key, { delta });
  }
  if (!deck || (!add && !remove)) return deltas;
  const before = manaBaseOf(deck);
  const after = manaBase(withSwap(deck.main, add, remove), deck.commanders, deck.deckColours);
  for (const need of before.colours) {
    const key = colourKey(need.colour);
    const next = after.colours.find((n) => n.colour === need.colour);
    if (!next || !lines.some((l) => l.key === key)) continue;
    const delta = Math.round((next.sources - need.sources) * DELTA_TENTHS) / DELTA_TENTHS;
    const cap = deck.colourSourceCap ?? null;
    const [targetBefore, targetAfter] = [colourTarget(need.needed, cap), colourTarget(next.needed, cap)];
    if (targetAfter !== targetBefore) deltas.set(key, { delta, target: targetAfter });
    else if (delta !== 0) deltas.set(key, { delta });
  }
  return deltas;
}
