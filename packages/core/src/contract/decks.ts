import type { CardSummary } from './cards';
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
  deckCount: number;
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

export interface DeckAnalysis {
  deck: DeckInput;
  colorIdentity: ColorIdentity;
  commanderKey: CommanderKeyRef;
  estimatedBracket: Bracket;
  gameChangerIds: CardId[];
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

export interface SavedDeckSummary {
  id: DeckId;
  name: string;
  commanderKey: CommanderKeyRef;
  isPublic: boolean;
  cardCount: number;
  updatedAt: IsoDateTime;
}
