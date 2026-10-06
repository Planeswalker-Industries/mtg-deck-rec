import type { CardSummary, TagRef } from './cards';
import type { CommanderKeyRef, CorpusConfidence, DeckInput } from './decks';
import type { Bracket, CardId, DeckId, IsoDateTime, TagId } from './ids';

export type RecMode = 'collection_less' | 'collection_aware';

export type OwnershipInput =
  /** Anonymous: collection lives in IndexedDB; ids sent per request. */
  | {
      kind: 'session';
      catalogEpoch: string;
      ownedCardIds: CardId[];
      /** Copies of each card in `ownedCardIds`, in the same order. Omitted means one copy each (clients before v20). */
      quantities?: number[];
    }
  /** Authenticated: server joins the persisted collection, and the copies the player's built decks hold. */
  | {
      kind: 'account';
      /** The saved deck being improved, if any: the copies it holds are its own, never a conflict. */
      deckId?: DeckId;
    };

/**
 * What a collection does to suggestions. only (the default): suggest cards the collection can supply, plus a separate
 * buy list of unowned cards that would do clearly better (cuts flag unowned cards). first: suggest from everything,
 * with owned cards ranked ahead of comparable ones; scores themselves are unchanged.
 */
export type OwnershipMode = 'only' | 'first';

export interface RecContext {
  deck: DeckInput;
  bracket: Bracket;
  bracketSource: 'inferred' | 'user';
  includeGameChangers: boolean;
  /** null = collection-less mode */
  ownership: OwnershipInput | null;
  /** How `ownership` applies. Omitted means 'only', which is what every client before v13 meant. */
  ownershipMode?: OwnershipMode;
}

/**
 * tag: does the same job (functional tag similarity) · manaValue: similar cost · staple: how widely the card is
 * reprinted, especially in Commander precons · corpus: play rate with this commander · votes: community votes.
 */
/**
 * `role`: the card fills a role the deck is short on (cards to add). `curve`: the deck is short of cards at the card's
 * mana value against the commander's learned curve (cards to add; weight 0 until the evaluation passes it).
 */
export type ScoreComponent = 'tag' | 'manaValue' | 'staple' | 'corpus' | 'votes' | 'role' | 'curve';

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

/** Cards dealt for the standalone card rater, for a commander or partner pair. */
export interface RaterDeal {
  commanderKey: CommanderKeyRef;
  /** Cards to rate replacements for, most played first (the rater shuffles them): what the commander's decks play, or cards widely played in its colors when it has no decks. Lands are left out. */
  cards: CardSummary[];
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
  /** Copies owned: of the card, or of the twin standing in for it. */
  quantity: number;
  /**
   * The card shown is an owned rules-identical twin standing in for this one, which the scores were read for (it is
   * the more played name). Absent when the card itself is owned.
   */
  standsInFor?: { id: CardId; name: string };
}

/** A saved deck marked built that holds a copy a suggestion would need. */
export interface DeckConflict {
  deckId: DeckId;
  code: string;
  name: string;
}

/** Why an unowned card is on the buy list ('only' mode with a collection). */
export interface BuyValue {
  /** How much higher it scores than the best card the collection supplies for the same slot (its add group, or the swap). */
  gain: number;
  /** gain / max(price, price floor): what the buy list is ranked by. null when the card has no price. */
  valueScore: number | null;
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
  /** Every owned copy is held by these built decks: the player can ask for swaps there to free one. */
  conflicts?: DeckConflict[];
}

export type BuySwapSuggestion = SwapSuggestion & BuyValue;

export interface SwapResult {
  mode: RecMode;
  target: CardSummary;
  confidence: CorpusConfidence;
  suggestions: SwapSuggestion[];
  /** 'only' mode: unowned replacements worth buying, best value first. Shown apart from the suggestions, as such. */
  buyList?: BuySwapSuggestion[];
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
  /** Every owned copy is held by these built decks: the player can ask for swaps there to free one. */
  conflicts?: DeckConflict[];
  /** Combos this card would complete that are above the deck's bracket: adding it takes the deck over the line. */
  completesOverBracket?: ComboRef[];
}

export type BuyAddSuggestion = AddSuggestion & BuyValue;

/** A Commander Spellbook combo. Credit and link Commander Spellbook wherever one shows. */
export interface ComboRef {
  /** Commander Spellbook's variant id: one exact set of cards. */
  id: string;
  /** The combo's page on commanderspellbook.com. */
  url: string;
  /** What it does: the standalone results ("Win the game"), then those that matter in context. */
  results: string[];
  /** The lowest bracket it belongs in, from Spellbook's bracket tag. */
  minBracket: Bracket;
}

/** "Complete a combo": a combo the deck is one named card short of, which its bracket allows. */
export interface ComboSuggestion extends ComboRef {
  /** The card the deck is missing. */
  card: CardSummary;
  /** The pieces already in the deck. */
  pieceIds: CardId[];
  /** Pieces Spellbook names by template ("a Legendary Elemental Creature"): also needed, not checked. */
  alsoNeeded: string[];
  /** The missing card's score as a card to add. */
  score: ScoreBreakdown;
  owned: OwnedInfo | null;
  conflicts?: DeckConflict[];
}

export interface AddResult {
  mode: RecMode;
  commanderKey: CommanderKeyRef;
  confidence: CorpusConfidence;
  groups: { category: CardCategory; suggestions: AddSuggestion[] }[];
  /** 'only' mode: unowned cards worth buying, best value first, every group together. Shown apart, as such. */
  buyList?: BuyAddSuggestion[];
  /** "Complete a combo": its own group, best result first. Credited and linked to Commander Spellbook. */
  combos?: ComboSuggestion[];
}

export type CutReason =
  | 'NOT_LEGAL'
  | 'OUTSIDE_COLOR_IDENTITY'
  | 'LOW_SYNERGY'
  | 'ROLE_REDUNDANT'
  | 'GAME_CHANGER_EXCLUDED'
  | 'OVER_BRACKET_GC_LIMIT'
  /** Mass land denial below the bracket that allows it: a hard limit, so a mandatory cut. */
  | 'OVER_BRACKET_MLD'
  /** A piece of a combo above the deck's bracket. Flagged, with a cut offered. */
  | 'OVER_BRACKET_COMBO'
  /** More extra-turn cards than the bracket allows, or a piece of an extra-turn loop. Flagged, with a cut offered. */
  | 'OVER_BRACKET_EXTRA_TURNS'
  | 'HIGH_MANA_VALUE'
  | 'NOT_OWNED';

/**
 * mandatory: the card works against the deck (breaks a rule, or the commander's decks all but never run it); cut it
 * whatever replaces it. suggested: a weaker fit, worth swapping for something better.
 */
export type CutSeverity = 'mandatory' | 'suggested';

export interface CutSuggestion {
  card: CardSummary;
  /** 0..1, higher = stronger cut candidate */
  cutScore: number;
  reasons: CutReason[];
  /** Mandatory cuts come first in `CutResult.suggestions`. */
  severity: CutSeverity;
  corpus: CorpusEvidence | null;
  owned: OwnedInfo | null;
}

export interface CutResult {
  mode: RecMode;
  confidence: CorpusConfidence;
  suggestions: CutSuggestion[];
}
