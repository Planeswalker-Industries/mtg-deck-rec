import type { CardSummary } from './cards';
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
  /**
   * Set code of the matched printing (upper case, as Scryfall's set code), or null for a match by name alone. Optional
   * because collections saved in a browser before v10 don't carry it; they just can't be filtered by set.
   */
  setCode?: string | null;
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

/** One card in a collection, whatever the printings: total copies and the sets of the printings owned. */
export interface CollectionEntry {
  cardId: CardId;
  quantity: number;
  /** Set codes of the owned printings; empty when every copy was matched by name alone. */
  setCodes: string[];
}

/** A Magic set, for the collection view's set filter. */
export interface CardSet {
  /** Upper case, as printings store it. */
  code: string;
  name: string;
  /** Scryfall's set_type: 'expansion', 'core', 'masters', 'commander', 'promo', … */
  setType: string;
  /** YYYY-MM-DD; null when Scryfall has none. */
  releasedAt: string | null;
}

/** A collection card with what the view filters on besides the card itself. */
export interface CollectionCardDetail {
  card: CardSummary;
  /** Functional tag labels, for matching the search box against what a card does. */
  tags: string[];
}

export interface CollectionCardsResult {
  cards: CollectionCardDetail[];
  /** The sets asked for that the catalog knows. */
  sets: CardSet[];
}
