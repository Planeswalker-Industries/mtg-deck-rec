import type { CardSummary, TagRef } from './cards';
import type { CommanderKeyRef, CorpusConfidence, DeckInput } from './decks';
import type { Bracket, CardId, IsoDateTime, TagId } from './ids';

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

/**
 * tag: does the same job (functional tag similarity) · manaValue: similar cost · staple: how widely the card is
 * reprinted, especially in Commander precons · corpus: play rate with this commander · votes: community votes.
 */
/** `role`: the card fills a role the deck is short on (cards to add). */
export type ScoreComponent = 'tag' | 'manaValue' | 'staple' | 'corpus' | 'votes' | 'role';

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
  /** 'commander': counted over the commander's decks. 'colors': over every corpus deck the card's colors allow, when the commander has no decks yet. */
  scope: 'commander' | 'colors';
  decksWith: number;
  /** Decks counted: the commander's, or every deck the card's colors allow (see scope). */
  commanderDeckCount: number;
  inclusionRate: number;
  synergy: number;
  /** Too few decks could have run the card yet (usually a new card): its play rate isn't used, and it's scored like a typical option. */
  limited: boolean;
  /**
   * Counted partly over borrowed decks (CommanderKeyRef.borrowedDeckCount) at their reduced weight, so decksWith and
   * commanderDeckCount are weighted estimates rather than deck counts. Absent otherwise.
   */
  pooled?: boolean;
}

export interface VoteSummary {
  /** Bayesian average, 0..1; equals the global prior when voteCount is 0. */
  score: number;
  voteCount: number;
  /** The caller's own vote on this pair (0 when they haven't voted); null when unknown. Signed-out voters are identified per visitor. */
  myVote: -1 | 0 | 1 | null;
}

/** Where a vote was cast: the deck tool's swipe view, or the standalone card rater with no decklist. */
export type VoteSource = 'deck' | 'rater';

/**
 * What the voter saw when they voted, so votes can later be weighed per shared tag and against the other candidates
 * shown for the same card.
 */
export interface VoteContext {
  source: VoteSource;
  /** Client-generated UUID grouping the votes from one sitting. */
  sessionId: string;
  /** The deck's commanders (at most 2); empty when rating without a commander. */
  commanderIds: CardId[];
  /** This candidate's position in the order shown, 0 first. */
  position: number;
  /** Every candidate shown for this target in the sitting, in order. */
  shownCardIds: CardId[];
  /** Tags shown as the job both cards do (TagMatch.candidateTag ids). */
  matchedTagIds: TagId[];
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
  /** Rules-identical to the target under a different name (e.g. a Universes Beyond rename). */
  functionalTwin: boolean;
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
