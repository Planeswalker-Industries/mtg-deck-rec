import type { ExportFormat, FavoriteRef, SyncStatusRow, TagAdminRow } from './account';
import type { CardDetail, CardSummary, TagRef } from './cards';
import type {
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
  SavedDeckSummary,
} from './decks';
import type { Result } from './errors';
import type { CardId, CommanderKeyId, DeckId, IsoDateTime, TagId } from './ids';
import type { AddResult, CutResult, RecContext, SwapResult, VoteSummary } from './recs';

/**
 * Recommendation reads. Transport: Route Handlers POST /api/recs/{swap,add,cut}
 * (parallel requests, WAF rate-limited). Not Server Actions — those are dispatched serially.
 */
export interface RecsApi {
  swap(input: { context: RecContext; targetCardId: CardId; limit?: number }): Promise<Result<SwapResult>>;
  add(input: { context: RecContext; limitPerCategory?: number }): Promise<Result<AddResult>>;
  cut(input: { context: RecContext; limit?: number }): Promise<Result<CutResult>>;
}

/** Mutations and user-triggered operations. Transport: Server Actions. */
export interface ActionsApi {
  /** text ≤ 20 KB */
  parseDeck(input: { text: string }): Promise<Result<ParseDeckResult>>;
  importDeckFromUrl(input: { url: string }): Promise<Result<ImportDeckUrlResult>>;
  /** Re-run after the user resolves ambiguous lines or picks a commander. */
  analyzeDeck(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>>;

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

  saveDeck(input: { deckId?: DeckId; name: string; deck: DeckInput; isPublic: boolean }): Promise<Result<{ deckId: DeckId }>>;
  deleteDeck(input: { deckId: DeckId }): Promise<Result<null>>;
  exportDeck(input: { deckId: DeckId; format: ExportFormat }): Promise<Result<{ filename: string; content: string }>>;

  /** value 0 clears the vote. */
  castVote(input: {
    targetCardId: CardId;
    replacementCardId: CardId;
    value: -1 | 0 | 1;
    commanderKeyId?: CommanderKeyId;
  }): Promise<Result<VoteSummary>>;
  setFavorite(input: FavoriteRef & { on: boolean }): Promise<Result<null>>;

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
