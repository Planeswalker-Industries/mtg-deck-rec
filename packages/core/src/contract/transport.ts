import type { ExportFormat, FavoriteRef, SyncStatusRow, TagAdminRow } from './account';
import type { CardDetail, CardSummary, TagRef, CardSearchInput } from './cards';
import type { CommanderCoverage, CommanderRequest } from './commander-requests';
import type {
  CollectionCardsResult,
  CollectionEntry,
  CollectionRowInput,
  CollectionTotals,
  ResolveCollectionResult,
  ResolvedCollectionRow,
  SourceApp,
} from './collection';
import type {
  CommanderKeyRef,
  DeckAnalysis,
  DeckInput,
  ImportDeckUrlResult,
  ParseDeckResult,
  SavedDeckContents,
  SavedDeckSummary,
} from './decks';
import type { Result } from './errors';
import type { Bracket, CardId, CommanderKeyId, DeckId, IsoDateTime, TagId } from './ids';
import type { AddResult, CutResult, RaterDeal, RecContext, SwapResult, VoteContext, VoteSummary } from './recs';

/**
 * Recommendation reads. Transport: Route Handlers POST /api/recs/{swap,add,cut}
 * (parallel requests, WAF rate-limited). Not Server Actions — those are dispatched serially.
 */
export interface RecsApi {
  swap(input: { context: RecContext; targetCardId: CardId; limit?: number }): Promise<Result<SwapResult>>;
  add(input: { context: RecContext; limitPerCategory?: number }): Promise<Result<AddResult>>;
  cut(input: { context: RecContext; limit?: number }): Promise<Result<CutResult>>;
}

/** Card lookups for pickers. Transport: GET Route Handlers under /api/cards (cacheable, parallel). */
export interface CatalogApi {
  /** Cards whose name matches `q` (at least 2 characters), best match first; `commanderEligible` keeps only cards that can lead a deck. */
  searchCards(input: CardSearchInput): Promise<Result<CardSummary[]>>;
  /** Functional tags per card, for grouping a deck by what its cards do. Cards with no tags are omitted. */
  cardTags(input: { cardIds: CardId[] }): Promise<Result<{ cardId: CardId; tags: TagRef[] }[]>>;
  /**
   * Cards with their functional tag labels, plus the named sets, for the collection view. ≤ 1,000 cards and 1,000 set
   * codes per call; a larger collection asks in chunks. Cards the catalog no longer has are left out.
   */
  collectionCards(input: { cardIds: CardId[]; setCodes: string[] }): Promise<Result<CollectionCardsResult>>;
}

/** Mutations and user-triggered operations. Transport: Server Actions. */
export interface ActionsApi {
  /** text ≤ 20 KB */
  parseDeck(input: { text: string }): Promise<Result<ParseDeckResult>>;
  importDeckFromUrl(input: { url: string }): Promise<Result<ImportDeckUrlResult>>;
  /** Re-run after the user resolves ambiguous lines or picks a commander. */
  analyzeDeck(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>>;

  /** Deck data lookups for commanders with too few decks. Checking coverage never starts a lookup. */
  getCommanderCoverage(input: { commanderId: CardId }): Promise<Result<CommanderCoverage>>;
  /** Starts a lookup, or joins the one already running for the same commander. */
  requestCommanderDecks(input: { commanderId: CardId }): Promise<Result<CommanderRequest>>;
  getCommanderRequest(input: { requestId: string }): Promise<Result<CommanderRequest>>;

  /** ≤ 2,000 rows per call. Works anonymously. */
  resolveCollectionRows(input: { rows: CollectionRowInput[] }): Promise<Result<ResolveCollectionResult>>;
  /** Authenticated. Send chunks with the returned importId; `final: true` commits and returns totals. */
  saveCollectionBatch(input: {
    importId: string | null;
    sourceApp: SourceApp;
    mode: 'replace' | 'merge';
    rows: ResolvedCollectionRow[];
    final: boolean;
  }): Promise<Result<{ importId: string; totals: CollectionTotals | null }>>;
  deleteCollection(): Promise<Result<null>>;
  /** Authenticated. The signed-in user's collection, one entry per card. */
  getMyCollectionEntries(): Promise<Result<CollectionEntry[]>>;

  /** Returns the deck's code as well as its id, so a deck just saved can be linked to and gone on editing. */
  saveDeck(input: {
    deckId?: DeckId;
    name: string;
    deck: DeckInput;
    isPublic: boolean;
    bracket?: Bracket;
    /**
     * The deck the player brought before the tool changed it. Kept once, as the deck's original: a deck that already
     * has one keeps it. Leave it out when nothing changed.
     */
    original?: DeckInput;
  }): Promise<Result<{ deckId: DeckId; code: string }>>;
  /** The caller's own saved deck, as decklist text to go on editing. NOT_FOUND for anyone else's. */
  openSavedDeck(input: { code: string }): Promise<Result<SavedDeckContents>>;
  /** Name only, without sending the card list. */
  renameDeck(input: { deckId: DeckId; name: string }): Promise<Result<null>>;
  /** Copies a deck the caller owns, subject to the same per-account cap as a new one. */
  duplicateDeck(input: { deckId: DeckId; name?: string }): Promise<Result<{ deckId: DeckId }>>;
  /** Shows or hides the deck page. Never changes whether the deck feeds play rates. */
  setDeckVisibility(input: { deckId: DeckId; isPublic: boolean }): Promise<Result<null>>;
  deleteDeck(input: { deckId: DeckId }): Promise<Result<null>>;
  exportDeck(input: { deckId: DeckId; format: ExportFormat }): Promise<Result<{ filename: string; content: string }>>;

  /** Whether replacementCardId is a good replacement for targetCardId. value 0 clears the vote. Works without an account. */
  castVote(input: {
    targetCardId: CardId;
    replacementCardId: CardId;
    value: -1 | 0 | 1;
    commanderKeyId?: CommanderKeyId;
    /** What the voter saw; send it from the swipe view and the rater. */
    context?: VoteContext;
  }): Promise<Result<VoteSummary>>;
  setFavorite(input: FavoriteRef & { on: boolean }): Promise<Result<null>>;

  /** Cards to rate replacements for with a commander or partner pair, given by card ids or by commander page slug (exactly one). */
  dealRaterCards(input: { commanderIds?: CardId[]; commanderSlug?: string }): Promise<Result<RaterDeal>>;

  adminSetTagDisabled(input: {
    tagId: TagId;
    disabled: boolean;
    reason: string;
    includeDescendants: boolean;
  }): Promise<Result<{ affected: TagId[] }>>;
}

export interface CommanderPageData {
  key: CommanderKeyRef;
  top: AddResult;
  roleProfile: { tag: TagRef; avgPerDeck: number }[];
  computedAt: IsoDateTime;
}

/** Server Component reads. Public reads are cached ('use cache' + cacheTag). */
export interface DataApi {
  getCardBySlug(slug: string): Promise<CardDetail | null>;
  getCardAlternatives(slug: string, opts?: { commanderSlug?: string }): Promise<SwapResult | null>;
  getCommanderBySlug(slug: string): Promise<CommanderPageData | null>;
  searchCards(q: string, opts?: { commanderEligible?: boolean; limit?: number }): Promise<CardSummary[]>;

  getMySavedDecks(): Promise<SavedDeckSummary[]>;
  getMyCollectionTotals(): Promise<CollectionTotals | null>;
  getMyFavorites(): Promise<FavoriteRef[]>;

  adminListTags(q?: string): Promise<TagAdminRow[]>;
  adminSyncStatus(): Promise<SyncStatusRow[]>;
}
