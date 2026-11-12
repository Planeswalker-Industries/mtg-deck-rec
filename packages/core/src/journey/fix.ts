import type { Bracket, CardId, CardSummary, ComboRef, FixCard, FixPool, StatChoices, StatTargets } from '../contract';
import { gameChangerLimit } from '../formats/commander/bracket';
import { COMMANDER_DECK_SIZE } from '../formats/commander/validate';
import { cardsOutsideBand } from '../scoring/bands';
import { curveBucket, isFrontLand, statCardType } from '../scoring/curve';
import { isBasicLand } from './builder';
import { applyCard, toTallyCard, type BracketInput, type DeckTally, type TallyCard } from './deck-tally';
import { colourlessLandsIn, colourTarget, manaBase, manaLetters, sourceCredit, type ColourlessLands } from './mana-base';

/**
 * Fix: paired moves, one card in and one out, that bring the Deck stats lines into their bands.
 *
 * - The *distance* of a deck is, over the counted lines, the cards each line sits outside its band (for a colour row
 *   the sources it is short, for the curve per bar). An ignored line counts nothing.
 * - A move is *valid* when it lowers the distance, lowers the gap of the line it is for, and pushes no line that was
 *   in its band out of it.
 * - Lines are taken in order: not legal, bracket, lands, basic lands, colour sources, roles, card types, curve; inside
 *   a group the largest gap first.
 * - A line under its band: the in cards that help it, best score first, each against the out cards, weakest first. A
 *   line over it: the out cards on the line, weakest first, each against the in cards that help a short line, then
 *   the rest, best first. The first valid pair is the move.
 * - An in card the collection doesn't supply (`FixCard.buyFor`) comes in only for a line the player opened to buying,
 *   and after every card the collection supplies: buying is for what the collection can't do.
 *
 * Every move lowers the distance, so a plan ends. Pure: the scores are those the pool was fetched with.
 */

// The pool's shapes are the contract's (v35): the server sends them, and the engine reads them as sent.
export type { FixCard, FixPool, StatChoice, StatChoices } from '../contract';

export interface FixMove {
  /** The line this move is for: 'legal', 'bracket', 'lands', 'basicLands', 'sources:U', a role id, a card type, 'curve'. */
  line: string;
  in: CardSummary;
  out: CardSummary;
}


/** A pair the player passed on. */
export interface FixPair {
  inId: CardId;
  outId: CardId;
}

export interface FixInput {
  /** The deck as it stands. Never mutated. */
  tally: DeckTally;
  targets: StatTargets;
  bracket: BracketInput;
  pool: FixPool;
  /** Pairs the player skipped: not offered again this round. Either card may come back in another pair. */
  skipped: readonly FixPair[];
  choices: StatChoices;
  /** Cards added this round: never taken out. */
  addedIds: readonly CardId[];
  /** Pieces of the complete combos the bracket allows (`comboPiecesToKeep`): never taken out. */
  protectedIds: readonly CardId[];
  /** Main-deck cards no deck under these commanders may hold (not legal, outside their colours): the first line. */
  illegalIds: readonly CardId[];
}

/** Why a line that is out of its band has no move left. */
export type FixBlock = 'skipped' | 'noCardIn' | 'noCardOut';

/** A counted line outside its band. */
export interface FixLine {
  line: string;
  /** Cards outside the band (sources short for a colour row, the bars together for the curve). */
  gap: number;
  /** Null while a valid move is left for it. */
  blocked: FixBlock | null;
}

/** A card brought in never goes out again, so a plan holds at most one move per main-deck slot. */
export const MAX_FIX_MOVES = COMMANDER_DECK_SIZE - 1;

/** Colour sources come in fractions (a Signet is 0.75): gaps closer than this are the same. */
const GAP_EPSILON = 1e-6;

/** The lines the player can't choose to ignore: they are rules, not typical counts. */
const NEVER_IGNORED: ReadonlySet<string> = new Set(['legal', 'bracket']);

const LEGAL = 'legal';
const BRACKET = 'bracket';
const LANDS = 'lands';
const BASIC_LANDS = 'basicLands';
const CURVE = 'curve';
const SOURCES_PREFIX = 'sources:';
const CURVE_PREFIX = 'curve:';

/** The order lines are fixed in. */
const GROUP = { legal: 0, bracket: 1, lands: 2, basicLands: 3, colours: 4, roles: 5, types: 6, curve: 7 } as const;

/** One measured line. `key` is per curve bar ('curve:3'); `line` is what the player sees ('curve'). */
interface Line {
  key: string;
  line: string;
  group: number;
  gap: number;
  /** Above the band (or a rule broken): the out card comes from the line. */
  over: boolean;
  /** A line with a band: its count and target, so a pair's effect is read without counting the deck again. */
  band?: { value: number; target: number };
}

interface Candidate {
  fix: FixCard;
  card: TallyCard;
  /** The banded lines one copy counts on. */
  keys: string[];
  /** Whether the bracket rules watch the card: only then is the bracket read again for a pair. */
  bracket: boolean;
}

/** The deck being fixed and what stays the same from move to move. */
interface Work {
  tally: DeckTally;
  targets: StatTargets;
  bracket: BracketInput;
  choices: StatChoices;
  deckColours: string;
  /** In cards, best first. */
  ins: Candidate[];
  /** Deck cards, weakest first. */
  outs: Candidate[];
  skipped: Set<string>;
  added: Set<CardId>;
  removed: Set<CardId>;
  kept: Set<CardId>;
  illegal: Set<CardId>;
}

/** The deck measured once: what a pair is compared against. */
interface Snapshot {
  lines: Map<string, Line>;
  /** The distance: every line's gap. */
  total: number;
  /** The colour rows' share of it. */
  colourTotal: number;
  /** Each colour row's hardest card's mana value, for reading a card's credit toward it. */
  needs: Map<string, number>;
  offenders: Set<CardId>;
  colourless: ColourlessLands;
}

const pairKey = (inId: CardId, outId: CardId) => `${inId}>${outId}`;
/** 1 for an in card the collection doesn't supply, which sorts after those it does. */
const bought = (c: Candidate) => (c.fix.buyFor === undefined ? 0 : 1);
const byName = (a: Candidate, b: Candidate) => a.fix.card.name.localeCompare(b.fix.card.name) || a.fix.card.id - b.fix.card.id;

const cloneTally = (tally: DeckTally): DeckTally => ({
  ...tally,
  roles: new Map(tally.roles),
  curve: [...tally.curve],
  types: new Map(tally.types),
  main: new Map(tally.main),
  commanderIds: new Set(tally.commanderIds),
  commanders: [...tally.commanders],
});

const inDeck = (tally: DeckTally, id: CardId) => tally.main.has(id) || tally.commanderIds.has(id);

/** Whether a combo is over the line for the chosen bracket, as Deck stats reads it. */
const comboOver = (combo: ComboRef, chosen: Bracket, limits: StatTargets['bracketLimits']) =>
  combo.minBracket > chosen || (chosen < limits.extraTurnLoopFromBracket && combo.results.some((r) => limits.extraTurnLoopResults.includes(r)));

/**
 * The pieces of the deck's complete combos the chosen bracket allows: Fix never takes one out. A combo over the bracket
 * is not kept: its pieces are what the bracket line takes out.
 */
export function comboPiecesToKeep(bracket: BracketInput, limits: StatTargets['bracketLimits']): CardId[] {
  const allowed = bracket.combos.filter((c) => c.alsoNeeded.length === 0 && !comboOver(c, bracket.chosen, limits));
  return [...new Set(allowed.flatMap((c) => c.pieceIds))];
}

/**
 * How far the deck is over its bracket, in cards to take out, and the main-deck cards that count against it: Game
 * Changers over the limit, mass land denial below the bracket that allows it, extra-turn cards over the limit, and a
 * piece of each complete combo above the bracket. 0 exactly when Deck stats' bracket line is in line.
 */
function bracketGap(tally: DeckTally, targets: StatTargets, bracket: BracketInput): { gap: number; offenders: Set<CardId> } {
  const limits = targets.bracketLimits;
  const offenders = new Set<CardId>();
  const blame = (ids: readonly CardId[]) => {
    for (const id of ids) if (tally.main.has(id)) offenders.add(id);
  };
  let gap = 0;
  const gameChangersOver = tally.gameChangers - gameChangerLimit(bracket.chosen);
  if (gameChangersOver > 0) {
    gap += gameChangersOver;
    blame([...tally.main.values()].filter((e) => e.card.gameChanger).map((e) => e.card.id));
  }
  if (bracket.chosen < limits.massLandDenialFromBracket) {
    const denial = bracket.signals.massLandDenialIds.filter((id) => inDeck(tally, id));
    gap += denial.length;
    blame(denial);
  }
  const extraTurns = bracket.signals.extraTurnIds.filter((id) => inDeck(tally, id));
  const turnLimit = limits.maxExtraTurnCards[String(bracket.chosen) as keyof typeof limits.maxExtraTurnCards] ?? Number.POSITIVE_INFINITY;
  if (extraTurns.length > turnLimit) {
    gap += extraTurns.length - turnLimit;
    blame(extraTurns);
  }
  for (const combo of bracket.combos) {
    if (combo.alsoNeeded.length > 0 || !combo.pieceIds.every((id) => inDeck(tally, id))) continue;
    if (!comboOver(combo, bracket.chosen, limits)) continue;
    gap += 1;
    blame(combo.pieceIds);
  }
  for (const [id, refs] of bracket.overBracketAdds) {
    if (!inDeck(tally, id) || !refs.some((c) => comboOver(c, bracket.chosen, limits))) continue;
    gap += 1;
    blame([id]);
  }
  return { gap, offenders };
}

const ignored = (work: Work, line: string) => work.choices[line] === 'ignore' && !NEVER_IGNORED.has(line);

/** The lines that are plain counts: every one but the colour rows. */
function countLines(work: Work, offenders: Set<CardId>): Line[] {
  const { tally, targets } = work;
  const lines: Line[] = [];
  const rule = (line: string, group: number, gap: number) => {
    if (!ignored(work, line)) lines.push({ key: line, line, group, gap, over: true });
  };
  const band = (key: string, line: string, group: number, value: number, target: number) => {
    if (!ignored(work, line)) lines.push({ key, line, group, gap: cardsOutsideBand(value, target), over: value > target, band: { value, target } });
  };
  let illegal = 0;
  for (const id of work.illegal) illegal += tally.main.get(id)?.quantity ?? 0;
  rule(LEGAL, GROUP.legal, illegal);
  const bracket = bracketGap(tally, targets, work.bracket);
  for (const id of bracket.offenders) offenders.add(id);
  rule(BRACKET, GROUP.bracket, bracket.gap);
  band(LANDS, LANDS, GROUP.lands, tally.lands, targets.lands);
  band(BASIC_LANDS, BASIC_LANDS, GROUP.basicLands, tally.basicLands, targets.basicLands);
  for (const r of targets.roles) band(r.roleId, r.roleId, GROUP.roles, tally.roles.get(r.roleId) ?? 0, r.target);
  for (const t of targets.types) band(t.cardType, t.cardType, GROUP.types, tally.types.get(t.cardType) ?? 0, t.target);
  targets.curve.forEach((target, bar) => band(`${CURVE_PREFIX}${bar}`, CURVE, GROUP.curve, tally.curve[bar] ?? 0, target));
  return lines;
}

/** The colour rows: a minimum, so only the sources a colour is short count. */
function colourLines(work: Work, needs?: Map<string, number>): Line[] {
  const cap = work.targets.colourSourceCap ?? null;
  const mana = manaBase([...work.tally.main.values()], work.tally.commanders, work.deckColours);
  const lines: Line[] = [];
  for (const need of mana.colours) {
    const line = `${SOURCES_PREFIX}${need.colour}`;
    needs?.set(need.colour, need.manaValue);
    if (ignored(work, line)) continue;
    lines.push({ key: line, line, group: GROUP.colours, gap: Math.max(0, colourTarget(need.needed, cap) - need.sources), over: false });
  }
  return lines;
}

function snapshot(work: Work): Snapshot {
  const offenders = new Set<CardId>();
  const needs = new Map<string, number>();
  const counts = countLines(work, offenders);
  const colours = colourLines(work, needs);
  const colourTotal = colours.reduce((sum, l) => sum + l.gap, 0);
  return {
    lines: new Map([...counts, ...colours].map((l) => [l.key, l])),
    total: counts.reduce((sum, l) => sum + l.gap, 0) + colourTotal,
    colourTotal,
    needs,
    offenders,
    colourless: colourlessLandsIn([...work.tally.main.values()]),
  };
}

/** The banded lines one copy of a card counts on: its roles, and lands or its curve bar and card type. */
function bandKeys(card: TallyCard): string[] {
  const keys = [...new Set(card.roles)];
  if (isFrontLand(card.typeLine)) {
    keys.push(LANDS);
    if (isBasicLand(card)) keys.push(BASIC_LANDS);
    return keys;
  }
  keys.push(`${CURVE_PREFIX}${curveBucket(card.manaValue)}`);
  const type = statCardType(card.typeLine);
  if (type) keys.push(type);
  return keys;
}

/** Whether a copy of the card counts on a line. */
function onLine(c: Candidate, key: string, work: Work, snap: Snapshot): boolean {
  if (key === LEGAL) return work.illegal.has(c.card.id);
  if (key === BRACKET) return snap.offenders.has(c.card.id);
  if (key.startsWith(SOURCES_PREFIX)) {
    const colour = key.slice(SOURCES_PREFIX.length);
    const manaValue = snap.needs.get(colour);
    return manaValue !== undefined && sourceCredit(c.card, colour, manaValue, work.deckColours, snap.colourless) > 0;
  }
  return c.keys.includes(key);
}

/** The lines outside their bands, in the order they are fixed. */
const brokenLines = (snap: Snapshot): Line[] =>
  [...snap.lines.values()].filter((l) => l.gap > GAP_EPSILON).sort((a, b) => a.group - b.group || b.gap - a.gap);

/**
 * In cards that may go in now for a line: not in the deck and not taken out by this plan (a basic land always may),
 * and, for a card the collection doesn't supply, only a line the player opened to buying that it helps.
 */
const liveIns = (work: Work, line: Line): Candidate[] =>
  work.ins.filter(
    (c) =>
      (isBasicLand(c.card) || (!inDeck(work.tally, c.card.id) && !work.removed.has(c.card.id))) &&
      (c.fix.buyFor === undefined || c.fix.buyFor.includes(line.line)),
  );

/** Deck cards that may come out now: still in the deck, not added this round, not a kept combo piece. */
const liveOuts = (work: Work): Candidate[] =>
  work.outs.filter((c) => work.tally.main.has(c.card.id) && !work.added.has(c.card.id) && !work.kept.has(c.card.id));

/** Runs `read` on the deck with one copy of `cardIn` in and one of `cardOut` out, and puts the deck back. */
function withPair<T>(work: Work, cardIn: TallyCard, cardOut: TallyCard, read: () => T): T {
  const { tally } = work;
  // The deck's own copy of the out card goes back as it was.
  const held = tally.main.get(cardOut.id)?.card ?? cardOut;
  applyCard(tally, cardIn, 1);
  applyCard(tally, held, -1);
  try {
    return read();
  } finally {
    applyCard(tally, held, 1);
    applyCard(tally, cardIn, -1);
  }
}

/**
 * Whether the pair lowers the distance and the line's own gap, and pushes no line that was in its band out of it. The
 * banded lines are read from the two cards alone; the bracket is read again only for a card its rules watch, and the
 * mana base only for a pair the counts allow.
 */
function valid(work: Work, snap: Snapshot, line: Line, cardIn: Candidate, cardOut: Candidate): boolean {
  if (cardIn.card.id === cardOut.card.id || work.illegal.has(cardIn.card.id)) return false;
  let counts = snap.total - snap.colourTotal;
  let lineGap = line.gap;
  const move = (key: string, gap: number): boolean => {
    const before = snap.lines.get(key);
    if (!before) return true;
    if (gap > GAP_EPSILON && before.gap <= GAP_EPSILON) return false;
    counts += gap - before.gap;
    if (key === line.key) lineGap = gap;
    return true;
  };
  const band = (key: string, delta: number): boolean => {
    const before = snap.lines.get(key)?.band;
    return !before || move(key, cardsOutsideBand(before.value + delta, before.target));
  };
  for (const key of cardIn.keys) if (!cardOut.keys.includes(key) && !band(key, 1)) return false;
  for (const key of cardOut.keys) if (!cardIn.keys.includes(key) && !band(key, -1)) return false;
  if (work.illegal.has(cardOut.card.id) && !move(LEGAL, (snap.lines.get(LEGAL)?.gap ?? 1) - 1)) return false;
  if ((cardIn.bracket || cardOut.bracket) && snap.lines.has(BRACKET)) {
    const gap = withPair(work, cardIn.card, cardOut.card, () => bracketGap(work.tally, work.targets, work.bracket).gap);
    if (!move(BRACKET, gap)) return false;
  }
  // The colour rows can only add to the distance: a pair the counts already rule out needs no mana base.
  if (counts >= snap.total - GAP_EPSILON) return false;
  const colourLine = line.key.startsWith(SOURCES_PREFIX);
  if (!colourLine && lineGap >= line.gap - GAP_EPSILON) return false;

  const colours = withPair(work, cardIn.card, cardOut.card, () => colourLines(work));
  let colourTotal = 0;
  if (colourLine) lineGap = 0;
  for (const l of colours) {
    if (l.gap > GAP_EPSILON && (snap.lines.get(l.key)?.gap ?? 0) <= GAP_EPSILON) return false;
    colourTotal += l.gap;
    if (l.key === line.key) lineGap = l.gap;
  }
  return counts + colourTotal < snap.total - GAP_EPSILON && lineGap < line.gap - GAP_EPSILON;
}

/** The first valid pair for a line; with `withSkipped`, the pairs the player passed on count too. */
function moveFor(work: Work, snap: Snapshot, line: Line, withSkipped = false): { in: Candidate; out: Candidate } | null {
  const ins = liveIns(work, line);
  const outs = liveOuts(work);
  const allowed = (cardIn: Candidate, cardOut: Candidate) => withSkipped || !work.skipped.has(pairKey(cardIn.card.id, cardOut.card.id));
  if (line.over) {
    const short = brokenLines(snap).filter((l) => !l.over);
    const helps = (c: Candidate) => short.some((l) => onLine(c, l.key, work, snap));
    const ordered = [...ins.filter(helps), ...ins.filter((c) => !helps(c))];
    for (const cardOut of outs.filter((c) => onLine(c, line.key, work, snap))) {
      for (const cardIn of ordered) {
        if (allowed(cardIn, cardOut) && valid(work, snap, line, cardIn, cardOut)) return { in: cardIn, out: cardOut };
      }
    }
    return null;
  }
  for (const cardIn of ins.filter((c) => onLine(c, line.key, work, snap))) {
    for (const cardOut of outs) {
      if (allowed(cardIn, cardOut) && valid(work, snap, line, cardIn, cardOut)) return { in: cardIn, out: cardOut };
    }
  }
  return null;
}

function start(input: FixInput): Work {
  const { bracket } = input;
  // The cards the bracket rules watch: Game Changers, mass land denial, extra turns and combo pieces.
  const watched = new Set<CardId>([
    ...bracket.signals.massLandDenialIds,
    ...bracket.signals.extraTurnIds,
    ...bracket.combos.flatMap((c) => c.pieceIds),
    ...bracket.overBracketAdds.keys(),
  ]);
  const candidate = (fix: FixCard): Candidate => {
    const card = toTallyCard(fix.card, fix.roles);
    return { fix, card, keys: bandKeys(card), bracket: card.gameChanger || watched.has(card.id) };
  };
  const once = (cards: readonly FixCard[]) => [...new Map(cards.map((c) => [c.card.id, c])).values()].map(candidate);
  return {
    tally: cloneTally(input.tally),
    targets: input.targets,
    bracket: input.bracket,
    choices: input.choices,
    deckColours: manaLetters(input.tally.commanders.flatMap((c) => [...(c.colorIdentity ?? '')])),
    // What the collection supplies first, then what would be bought; best score first in each.
    ins: once(input.pool.ins).sort((a, b) => bought(a) - bought(b) || b.fix.score - a.fix.score || byName(a, b)),
    outs: once(input.pool.deck).sort((a, b) => a.fix.score - b.fix.score || byName(a, b)),
    skipped: new Set(input.skipped.map((p) => pairKey(p.inId, p.outId))),
    added: new Set(input.addedIds),
    removed: new Set(),
    kept: new Set(input.protectedIds),
    illegal: new Set(input.illegalIds),
  };
}

function nextMove(work: Work): { move: FixMove; in: Candidate; out: Candidate } | null {
  const snap = snapshot(work);
  for (const line of brokenLines(snap)) {
    const pair = moveFor(work, snap, line);
    if (pair) return { move: { line: line.line, in: pair.in.fix.card, out: pair.out.fix.card }, ...pair };
  }
  return null;
}

/** The next move: the first line, in order, that has a valid pair. Null when no line has one. */
export function nextFixMove(input: FixInput): FixMove | null {
  return nextMove(start(input))?.move ?? null;
}

/** Every move, each found on the deck as the moves before it leave it: what "Fix the rest for me" previews. */
export function planFixes(input: FixInput): FixMove[] {
  const work = start(input);
  const moves: FixMove[] = [];
  while (moves.length < MAX_FIX_MOVES) {
    const next = nextMove(work);
    if (!next) break;
    applyCard(work.tally, next.in.card, 1);
    applyCard(work.tally, work.tally.main.get(next.out.card.id)?.card ?? next.out.card, -1);
    // Copies of a basic land are all alike: one coming in doesn't pin the rest, and one going out may come back.
    if (!isBasicLand(next.in.card)) work.added.add(next.in.card.id);
    if (!isBasicLand(next.out.card)) work.removed.add(next.out.card.id);
    moves.push(next.move);
  }
  return moves;
}

/**
 * The counted lines outside their bands, in the order Fix takes them, each with whether a move is left for it and, when
 * none is, why: every pair left was skipped, no card to bring in, or no card that is safe to take out.
 */
export function fixLines(input: FixInput): FixLine[] {
  const work = start(input);
  const snap = snapshot(work);
  const out = new Map<string, FixLine>();
  for (const line of brokenLines(snap)) {
    let blocked: FixBlock | null = null;
    if (!moveFor(work, snap, line)) {
      if (moveFor(work, snap, line, true)) blocked = 'skipped';
      else if (line.over) blocked = liveOuts(work).some((c) => onLine(c, line.key, work, snap)) ? 'noCardIn' : 'noCardOut';
      else blocked = liveIns(work, line).some((c) => onLine(c, line.key, work, snap)) ? 'noCardOut' : 'noCardIn';
    }
    const known = out.get(line.line);
    // The curve's bars read as one line: open while any bar has a move left.
    if (!known) out.set(line.line, { line: line.line, gap: line.gap, blocked });
    else out.set(line.line, { line: line.line, gap: known.gap + line.gap, blocked: known.blocked === null || blocked === null ? null : known.blocked });
  }
  return [...out.values()];
}
