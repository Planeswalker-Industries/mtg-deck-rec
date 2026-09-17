import type { CardId, ColorIdentity, Finish, IsoDateTime, OracleId, TagId } from './ids';

/** Estimate only: Scryfall prices go stale after 24h. Always render with `asOf`. */
export interface PriceEstimate {
  usd: number;
  finish: Finish;
  asOf: IsoDateTime;
  source: 'scryfall';
}

/** Scryfall CDN image URLs for one card face (hotlinked, never mirrored). */
export interface CardImageSet {
  /** 146×204 */
  small: string;
  /** 488×680 — default for grids */
  normal: string;
  /** 672×936 */
  large: string;
  /** art only, variable size */
  artCrop: string;
}

export interface CardImages {
  front: CardImageSet;
  /** Double-faced cards only. */
  back: CardImageSet | null;
}

export interface CardSummary {
  id: CardId;
  oracleId: OracleId;
  name: string;
  slug: string;
  manaValue: number;
  typeLine: string;
  colorIdentity: ColorIdentity;
  /** null when Scryfall has no image for the card */
  images: CardImages | null;
  gameChanger: boolean;
  /** false for preview cards from unreleased sets */
  released: boolean;
  /** Scryfall rules keywords (Deathtouch, Menace). Empty for most cards. Not Tagger tags: those come from cardTags. */
  keywords: string[];
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
