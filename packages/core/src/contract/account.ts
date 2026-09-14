import type { TagRef } from './cards';
import type { IsoDateTime } from './ids';

export type FavoriteKind = 'card' | 'commander' | 'deck';

export type ExportFormat = 'text' | 'arena' | 'moxfield' | 'archidekt_csv';

export interface FavoriteRef {
  kind: FavoriteKind;
  refId: string;
}

export interface TagAdminRow {
  tag: TagRef;
  cardCount: number;
  disabled: boolean;
  disabledReason: string | null;
  disabledAt: IsoDateTime | null;
}

export interface SyncStatusRow {
  job: string;
  status: string;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  rowsChanged: number;
  error: string | null;
}
