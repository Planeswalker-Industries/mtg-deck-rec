import type { CardId, Finish, IsoDateTime, PrintingId } from './ids';

export type SourceApp = 'manabox' | 'moxfield' | 'tcgplayer' | 'generic_csv' | 'generic_json' | 'text';

/** One row as parsed client-side from an export file. */
export interface CollectionRowInput {
  rowNo: number;
  name?: string;
  scryfallId?: string;
  tcgplayerId?: number;
  setCode?: string;
  collectorNumber?: string;
  lang?: string;
  finish?: Finish;
  condition?: string;
  quantity: number;
}

export type CollectionResolveVia = 'scryfall_id' | 'tcgplayer_id' | 'set_cn_lang' | 'set_cn' | 'name_only';

export interface ResolvedCollectionRow {
  rowNo: number;
  /** null when only the card (not the printing) could be identified */
  printingId: PrintingId | null;
  cardId: CardId;
  finish: Finish;
  condition: string;
  lang: string;
  quantity: number;
  via: CollectionResolveVia;
}

export interface UnresolvedCollectionRow {
  rowNo: number;
  input: CollectionRowInput;
  reason: 'NOT_FOUND' | 'AMBIGUOUS' | 'INVALID';
}

export interface ResolveCollectionResult {
  /** Clients store this; a mismatch later means card ids must be re-resolved. */
  catalogEpoch: string;
  resolved: ResolvedCollectionRow[];
  unresolved: UnresolvedCollectionRow[];
}

export interface CollectionTotals {
  uniqueCards: number;
  totalQuantity: number;
  updatedAt: IsoDateTime;
}
