import type { CardSummary } from './cards';
import type { ComboRef } from './recs';
import type { Bracket, CardId, ColorIdentity, CommanderKeyId, DeckId, Finish, IsoDateTime } from './ids';

export type DeckSection = 'commander' | 'main' | 'sideboard' | 'maybeboard' | 'companion';

export type LineFlag = 'alchemy_mapped' | 'fuzzy' | 'ambiguous' | 'unresolved' | 'set_mismatch';

export interface ParsedLine {
  lineNo: number;
  raw: string;
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  finish?: Finish;
  section: DeckSection;
  flags: LineFlag[];
}

export type ResolveVia = 'set_cn' | 'exact' | 'front_face' | 'flavor_name' | 'alchemy_mapped' | 'fuzzy';

export type Resolution =
  | { status: 'resolved'; card: CardSummary; via: ResolveVia }
  | { status: 'ambiguous'; options: CardSummary[] }
  | { status: 'unresolved'; suggestions: CardSummary[] };

export interface ResolvedLine {
  line: ParsedLine;
  resolution: Resolution;
}

export interface DeckCardEntry {
  cardId: CardId;
  quantity: number;
  section: DeckSection;
}

export interface DeckInput {
  commanders: CardId[];
  cards: DeckCardEntry[];
}

/** none: n < N_min · low: N_min ≤ n < N_full · full: n ≥ N_full */
export type CorpusConfidence = 'none' | 'low' | 'full';

export interface CommanderKeyRef {
  /** null when the commander (pair) has no corpus decks yet */
  id: CommanderKeyId | null;
  slug: string | null;
  commanders: CardSummary[];
  /** Decks with exactly these commanders. */
  deckCount: number;
  /**
   * Other decks led by one of these commanders (a partner's solo decks or its other pairings), borrowed because deckCount
   * is below N_min. Each counts for less than one of these commanders' own decks. Absent when none were borrowed.
   */
  borrowedDeckCount?: number;
  /** From deckCount plus the borrowed decks at their reduced weight; never 'full' while borrowing. */
  confidence: CorpusConfidence;
}

export type DeckIssueCode =
  | 'NOT_LEGAL'
  | 'OUTSIDE_COLOR_IDENTITY'
  | 'SINGLETON_VIOLATION'
  | 'WRONG_DECK_SIZE'
  | 'INVALID_COMMANDER'
  | 'INVALID_PARTNER_PAIR'
  | 'OVER_BRACKET_GC_LIMIT'
  | 'MISSING_COMMANDER';

export interface DeckIssue {
  code: DeckIssueCode;
  cardId?: CardId;
  message: string;
}

/** What the bracket estimate read from a deck (T060). */
export interface BracketSignals {
  gameChangerCount: number;
  /** Mass land denial (Tagger's tag, planeswalkers left out): allowed from bracket 4. */
  massLandDenialIds: CardId[];
  /** Extra-turn cards (Tagger's tag, planeswalkers left out). */
  extraTurnIds: CardId[];
  /** The highest minimum bracket among the deck's complete combos; null with none. */
  comboBracket: Bracket | null;
  /** A complete combo takes infinite turns. */
  extraTurnLoop: boolean;
}

/** A combo the deck holds every named piece of. Credit and link Commander Spellbook wherever it shows. */
export interface DeckCombo extends ComboRef {
  pieceIds: CardId[];
  /** Pieces Spellbook names by template: not checked, so a combo with any doesn't count toward the bracket. */
  alsoNeeded: string[];
}

export interface DeckAnalysis {
  deck: DeckInput;
  colorIdentity: ColorIdentity;
  commanderKey: CommanderKeyRef;
  /** The lowest bracket the deck fits, within 2–4: 1 and 5 depend on intent. */
  estimatedBracket: Bracket;
  bracketSignals: BracketSignals;
  gameChangerIds: CardId[];
  /** The combos the deck holds, from Commander Spellbook. */
  combos: DeckCombo[];
  issues: DeckIssue[];
  /** Present when issues contains MISSING_COMMANDER. */
  commanderCandidates?: CardSummary[];
}

export interface ParseDeckResult {
  lines: ResolvedLine[];
  /** null until every line is resolved and a commander is known */
  analysis: DeckAnalysis | null;
}

export interface ImportDeckUrlResult extends ParseDeckResult {
  source: 'archidekt' | 'moxfield';
  sourceUrl: string;
}

/**
 * A saved deck as its owner's decklist, so the tool can open one and go on editing it.
 *
 * Text rather than card ids: the deck tool's decklist box is what the player edits, and re-parsing the text is what
 * produces the resolved lines, the analysis and the recommendations.
 */
export interface SavedDeckContents {
  deckId: DeckId;
  code: string;
  name: string;
  /** The stored bracket, when the deck has one. */
  bracket?: Bracket;
  /** Decklist text, commanders first, in the format the tool's box takes. */
  text: string;
}

export interface SavedDeckSummary {
  id: DeckId;
  /** Short random code used in the URL. Never derived from the name, and stable across renames. */
  code: string;
  name: string;
  commanderKey: CommanderKeyRef;
  /**
   * New decks are public. This controls the shared page only: a private deck is hidden from others but its card
   * choices still count toward play rates, and the control that sets it has to say so.
   */
  isPublic: boolean;
  /**
   * The player has put this deck together: its cards are taken, so suggestions for their other decks tag a card held
   * here as a conflict. A list still being brewed holds nothing.
   */
  isBuilt: boolean;
  cardCount: number;
  /** The stored bracket, estimated or overridden, when one is known. */
  bracket?: Bracket;
  updatedAt: IsoDateTime;
}
