import type { CardCategory } from './recs';
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

/**
 * A card search. With a name, cards whose names match, best match first. With only filters (the deckbuilder's browse),
 * the filtered cards most played across Commander decks. `q` must be 2+ characters unless a filter is set.
 */
export interface CardSearchInput {
  q: string;
  commanderEligible?: boolean;
  limit?: number;
  /** Cards must fit within these colours: a commander's identity as WUBRG letters; "" means colourless only. */
  colorIdentity?: string;
  /** The deck-grouping type (an artifact creature is a creature). */
  cardType?: CardCategory;
  /** Whole mana value; the top of the curve (7) means 7 or more. */
  manaValue?: number;
  /** Skip this many results, for a "more" button. Filtered searches only. */
  offset?: number;
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
