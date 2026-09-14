import type { CardSummary, TagRef } from './cards';
import type { CommanderKeyRef, CorpusConfidence, DeckInput } from './decks';
import type { Bracket, CardId, IsoDateTime } from './ids';

export type RecMode = 'collection_less' | 'collection_aware';

export type OwnershipInput =
  /** Anonymous: collection lives in IndexedDB; ids sent per request. */
  | { kind: 'session'; catalogEpoch: string; ownedCardIds: CardId[] }
  /** Authenticated: server joins the persisted collection. */
  | { kind: 'account' };

export interface RecContext {
  deck: DeckInput;
  bracket: Bracket;
  bracketSource: 'inferred' | 'user';
  includeGameChangers: boolean;
  /** null = collection-less mode */
  ownership: OwnershipInput | null;
}

export type ScoreComponent = 'tag' | 'manaValue' | 'corpus' | 'votes';

export interface ScoreBreakdown {
  /** 0..1 */
  total: number;
  /** Each normalized 0..1; null when the component is unavailable. */
  components: Record<ScoreComponent, number | null>;
  /** Weights actually applied after renormalizing over available components. */
  effectiveWeights: Record<ScoreComponent, number>;
}

export interface TagMatch {
  targetTag: TagRef;
  candidateTag: TagRef;
  /** Shared ancestor when not an exact match. */
  via: TagRef | null;
  /** 0 = exact match */
  distance: number;
}

export interface CorpusEvidence {
  decksWith: number;
  commanderDeckCount: number;
  inclusionRate: number;
  synergy: number;
}

export interface VoteSummary {
  /** Bayesian average, 0..1; equals the global prior when voteCount is 0. */
  score: number;
  voteCount: number;
  /** null when anonymous */
  myVote: -1 | 0 | 1 | null;
}

export type CostBasis =
  | 'buy_replacement_vs_buy_target'
  | 'owned_replacement'
  | 'both_owned'
  | 'price_unavailable';

/** Estimate only. Negative = saves money. */
export interface CostDelta {
  usd: number | null;
  basis: CostBasis;
  asOf: IsoDateTime | null;
}

export interface OwnedInfo {
  quantity: number;
}

export interface SwapSuggestion {
  card: CardSummary;
  score: ScoreBreakdown;
  matchedTags: TagMatch[];
  corpus: CorpusEvidence | null;
  votes: VoteSummary;
  costDelta: CostDelta;
  owned: OwnedInfo | null;
}

export interface SwapResult {
  mode: RecMode;
  target: CardSummary;
  confidence: CorpusConfidence;
  suggestions: SwapSuggestion[];
  emptyReason?: 'NO_TAGS_ON_TARGET' | 'NOTHING_OWNED_FITS' | 'NO_CANDIDATES';
}

export type CardCategory =
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'battle'
  | 'land';

export interface AddSuggestion {
  card: CardSummary;
  category: CardCategory;
  score: ScoreBreakdown;
  corpus: CorpusEvidence | null;
  /** Roles this card fills that the deck is short on vs the commander's role profile. */
  fillsRoles: TagRef[];
  owned: OwnedInfo | null;
}

export interface AddResult {
  mode: RecMode;
  commanderKey: CommanderKeyRef;
  confidence: CorpusConfidence;
  groups: { category: CardCategory; suggestions: AddSuggestion[] }[];
}

export type CutReason =
  | 'NOT_LEGAL'
  | 'OUTSIDE_COLOR_IDENTITY'
  | 'LOW_SYNERGY'
  | 'ROLE_REDUNDANT'
  | 'GAME_CHANGER_EXCLUDED'
  | 'OVER_BRACKET_GC_LIMIT'
  | 'HIGH_MANA_VALUE'
  | 'NOT_OWNED';

export interface CutSuggestion {
  card: CardSummary;
  /** 0..1, higher = stronger cut candidate */
  cutScore: number;
  reasons: CutReason[];
  corpus: CorpusEvidence | null;
  owned: OwnedInfo | null;
}

export interface CutResult {
  mode: RecMode;
  confidence: CorpusConfidence;
  suggestions: CutSuggestion[];
}
