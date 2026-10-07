import {
  extraTurnLimit,
  isCheckedComplete,
  isExtraTurnLoop,
  massLandDenialAllowed,
  type BracketCards,
  type BracketRules,
  type ComboFacts,
} from '../formats/commander/bracket';
import type { Bracket } from '../contract';
import type { ScoringConfig } from './config';

/** What the bracket rules know about a deck (T060): the rules, the cards they watch, and the deck's combos. */
export interface DeckBracketFacts {
  rules: BracketRules;
  cards: BracketCards;
  /** Complete combos, and for adds the ones the deck is one named card short of (`missing`). */
  combos: readonly ComboFacts[];
}

const compiled = new WeakMap<ScoringConfig['combos'], { pattern: RegExp; weight: number }[]>();

function classesOf(settings: ScoringConfig['combos']) {
  let classes = compiled.get(settings);
  if (!classes) {
    classes = settings.resultClasses.map((c) => ({ pattern: new RegExp(c.match, 'i'), weight: c.weight }));
    compiled.set(settings, classes);
  }
  return classes;
}

/**
 * How much a combo's results are worth (scoring-design.md, "Combos"): its best standalone result by the first class
 * that matches ("Win the game" over infinite mana, damage or turns over the rest), a contextual result below those.
 */
export function comboResultWeight(combo: Pick<ComboFacts, 'results' | 'contextualResults'>, settings: ScoringConfig['combos']): number {
  const classes = classesOf(settings);
  let best = combo.contextualResults.length > 0 ? settings.contextualWeight : 0;
  for (const result of combo.results) {
    best = Math.max(best, classes.find((c) => c.pattern.test(result))?.weight ?? settings.standaloneWeight);
  }
  return best;
}

/** Whether a combo is over the line for a bracket: above its minimum, or an extra-turn loop the bracket forbids. */
export const overBracket = (combo: ComboFacts, bracket: Bracket, rules: BracketRules): boolean =>
  combo.minBracket > bracket || (bracket < rules.extraTurnLoopFromBracket && isExtraTurnLoop(combo, rules));

/** The cards a bracket keeps out of suggestions: mass land denial below the bracket that allows it (a hard rule). */
export function bracketExclusions(facts: DeckBracketFacts | null | undefined, bracket: Bracket): ReadonlySet<number> {
  if (!facts || massLandDenialAllowed(bracket, facts.rules)) return new Set();
  return facts.cards.massLandDenial;
}

/** Per card of the deck, what the bracket rules say about it, for cuts. */
export interface CutBracketMarks {
  massLandDenial: boolean;
  extraTurn: boolean;
  overBracketCombo: boolean;
  extraTurnLoop: boolean;
  comboPiece: boolean;
}

/** Marks for the deck's cards: over-bracket combo pieces, loop pieces and allowed combo pieces (commanders never). */
export function cutBracketMarks(facts: DeckBracketFacts, bracket: Bracket, commanderIds: readonly number[]) {
  const commanders = new Set(commanderIds);
  const complete = facts.combos.filter(isCheckedComplete);
  const piecesOf = (combos: readonly ComboFacts[]) => new Set(combos.flatMap((c) => c.pieces).filter((id) => !commanders.has(id)));
  const loops = bracket < facts.rules.extraTurnLoopFromBracket ? complete.filter((c) => isExtraTurnLoop(c, facts.rules)) : [];
  const loopPieces = piecesOf(loops);
  const overPieces = piecesOf(complete.filter((c) => c.minBracket > bracket));
  const allowedPieces = piecesOf(complete.filter((c) => !overBracket(c, bracket, facts.rules)));
  return {
    options: { massLandDenialAllowed: massLandDenialAllowed(bracket, facts.rules), extraTurnLimit: extraTurnLimit(bracket, facts.rules) },
    marks: (cardId: number): CutBracketMarks => ({
      massLandDenial: facts.cards.massLandDenial.has(cardId),
      extraTurn: facts.cards.extraTurns.has(cardId),
      overBracketCombo: overPieces.has(cardId),
      extraTurnLoop: loopPieces.has(cardId),
      comboPiece: allowedPieces.has(cardId),
    }),
  };
}
