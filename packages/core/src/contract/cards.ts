import type { CardId, ColorIdentity, Finish, IsoDateTime, OracleId, TagId } from './ids';

/** Estimate only: Scryfall prices go stale after 24h. Always render with `asOf`. */
export interface PriceEstimate {
  usd: number;
  finish: Finish;
  asOf: IsoDateTime;
  source: 'scryfall';
}

export interface CardSummary {
  id: CardId;
  oracleId: OracleId;
  name: string;
  slug: string;
  manaValue: number;
  typeLine: string;
  colorIdentity: ColorIdentity;
  imageUri: string | null;
  gameChanger: boolean;
  /** false for preview cards from unreleased sets */
  released: boolean;
  price: PriceEstimate | null;
}

export interface TagRef {
  id: TagId;
  slug: string;
  label: string;
  /** Tagger tagging weight, normalized 0..1. Present when the ref describes a tagging. */
  weight?: number;
  /** Hierarchy distance when the ref was reached via traversal. */
  depth?: number;
}

export interface CardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
}

export type CommanderLegality = 'legal' | 'not_legal' | 'banned' | 'restricted';

export interface CardDetail extends CardSummary {
  oracleText: string | null;
  layout: string;
  faces: CardFace[] | null;
  legalCommander: CommanderLegality;
  canBeCommander: boolean;
  /** Direct taggings. */
  tags: TagRef[];
  /** Ancestors of the direct tags, deduplicated. */
  tagAncestors: TagRef[];
  scryfallUri: string;
}
