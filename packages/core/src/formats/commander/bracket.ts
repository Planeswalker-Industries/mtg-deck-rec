import { z } from 'zod';
import type { Bracket, BracketSignals, CardId, ComboRef, DeckCombo } from '../../contract';

/** Game Changers allowed per bracket (Commander Brackets, Feb 2026 update). */
export function gameChangerLimit(bracket: Bracket): number {
  if (bracket <= 2) return 0;
  if (bracket === 3) return 3;
  return Number.POSITIVE_INFINITY;
}

/** Game Changers are excluded from suggestions by default for brackets 1–2 and included for 3–5. */
export function defaultIncludeGameChangers(bracket: Bracket): boolean {
  return bracket >= 3;
}

/** The brackets an estimate can land in, lowest first: 1 against 2 and 4 against 5 depend on intent. */
const ESTIMATED_BRACKETS: readonly Bracket[] = [2, 3];
/** What a deck too strong for every estimated bracket is called. */
const HIGHEST_ESTIMATE: Bracket = 4;

const bracketNumber = z.int().min(1).max(5);

/**
 * `app_config.brackets` (T060; owner answers 2026-10-05): the Tagger tags that mark mass land denial and extra turns,
 * the bracket mass land denial is allowed from, the extra-turn cards each lower bracket allows (a bracket not listed
 * has no limit), and the combo results that mean an extra-turn loop with the bracket that allows one.
 */
export const bracketRulesSchema = z.object({
  massLandDenialTagIds: z.array(z.string()),
  extraTurnTagIds: z.array(z.string()),
  massLandDenialFromBracket: bracketNumber,
  // Keyed by bracket number: a key that isn't one ("03", "3 ") would otherwise lift that bracket's limit unnoticed.
  maxExtraTurnCards: z.partialRecord(z.enum(['1', '2', '3', '4', '5']), z.int().min(0)),
  extraTurnLoopResults: z.array(z.string()),
  extraTurnLoopFromBracket: bracketNumber,
});

export type BracketRules = z.infer<typeof bracketRulesSchema>;

/** `app_config.brackets`, validated. Throws on a missing or malformed value. */
export function parseBracketRules(value: unknown): BracketRules {
  const parsed = bracketRulesSchema.safeParse(value);
  if (!parsed.success) throw new Error(`app_config.brackets is missing or malformed: ${parsed.error.message}`);
  return parsed.data;
}

export const massLandDenialAllowed = (bracket: Bracket, rules: BracketRules): boolean => bracket >= rules.massLandDenialFromBracket;

/** Extra-turn cards the bracket allows; no limit for a bracket the rules don't list. */
export const extraTurnLimit = (bracket: Bracket, rules: BracketRules): number =>
  rules.maxExtraTurnCards[String(bracket) as keyof BracketRules['maxExtraTurnCards']] ?? Number.POSITIVE_INFINITY;

/** The cards the bracket rules watch (`bracket_cards()`). */
export interface BracketCards {
  massLandDenial: ReadonlySet<number>;
  extraTurns: ReadonlySet<number>;
}

/** Commander Spellbook's page for a combo. */
export const SPELLBOOK_COMBO_URL = 'https://commanderspellbook.com/combo/';
export const comboUrl = (variantId: string): string => `${SPELLBOOK_COMBO_URL}${variantId}/`;

/** A combo as `serving_deck_combos` reads it for a deck. */
export interface ComboFacts {
  variantId: string;
  /** Every named piece, ascending. */
  pieces: readonly number[];
  minBracket: number;
  results: readonly string[];
  contextualResults: readonly string[];
  /** Pieces Spellbook names by template, which nothing here can check. */
  templateNames: readonly string[];
  /** The one named piece the deck lacks; null when it holds every one. */
  missing: number | null;
}

/** Complete and checkable: the deck holds every named piece and there is no template piece to match by hand. */
export const isCheckedComplete = (combo: ComboFacts): boolean => combo.missing === null && combo.templateNames.length === 0;

/** A combo's minimum bracket, kept inside 1–5. */
const asBracket = (n: number): Bracket => Math.min(5, Math.max(1, Math.round(n))) as Bracket;

export function comboRef(combo: ComboFacts): ComboRef {
  return {
    id: combo.variantId,
    url: comboUrl(combo.variantId),
    results: [...combo.results, ...combo.contextualResults],
    minBracket: asBracket(combo.minBracket),
  };
}

export function deckCombo(combo: ComboFacts): DeckCombo {
  return { ...comboRef(combo), pieceIds: combo.pieces.map((id) => id as CardId), alsoNeeded: [...combo.templateNames] };
}

/** Whether a complete combo takes infinite turns. */
export const isExtraTurnLoop = (combo: ComboFacts, rules: BracketRules): boolean =>
  [...combo.results, ...combo.contextualResults].some((r) => rules.extraTurnLoopResults.includes(r));

/** What the estimate reads from a deck: its cards (commanders included) and the combos it holds. */
export function bracketSignals(
  cardIds: readonly number[],
  isGameChanger: (cardId: number) => boolean,
  cards: BracketCards,
  combos: readonly ComboFacts[],
  rules: BracketRules,
): BracketSignals {
  const ids = [...new Set(cardIds)];
  const complete = combos.filter(isCheckedComplete);
  const comboBracket = complete.reduce<number | null>((max, c) => Math.max(max ?? 0, c.minBracket), null);
  return {
    gameChangerCount: ids.filter(isGameChanger).length,
    massLandDenialIds: ids.filter((id) => cards.massLandDenial.has(id)).map((id) => id as CardId),
    extraTurnIds: ids.filter((id) => cards.extraTurns.has(id)).map((id) => id as CardId),
    comboBracket: comboBracket === null ? null : asBracket(comboBracket),
    extraTurnLoop: complete.some((c) => isExtraTurnLoop(c, rules)),
  };
}

/** Whether a deck with these signals fits a bracket under every rule. */
export function fitsBracket(signals: BracketSignals, bracket: Bracket, rules: BracketRules): boolean {
  return (
    signals.gameChangerCount <= gameChangerLimit(bracket) &&
    (signals.massLandDenialIds.length === 0 || massLandDenialAllowed(bracket, rules)) &&
    signals.extraTurnIds.length <= extraTurnLimit(bracket, rules) &&
    (!signals.extraTurnLoop || bracket >= rules.extraTurnLoopFromBracket) &&
    (signals.comboBracket ?? 1) <= bracket
  );
}

/**
 * A rough estimate, labelled as such in the UI: the lowest bracket the deck fits (Game Changers, mass land denial,
 * extra turns, combos), kept within 2–4 because 1 against 2 and 4 against 5 depend on intent. No tutor limit: WotC
 * removed it in October 2025.
 */
export function estimateBracket(signals: BracketSignals, rules: BracketRules): Bracket {
  return ESTIMATED_BRACKETS.find((b) => fitsBracket(signals, b, rules)) ?? HIGHEST_ESTIMATE;
}
