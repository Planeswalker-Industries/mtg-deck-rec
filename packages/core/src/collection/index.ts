import type { CardSet, ColorIdentity } from '../contract';
import { cardCategory } from '../scoring/add';

/**
 * The collection view's groups, in the order they're shown. A card goes in the first that fits: an artifact creature
 * is a creature, a legendary creature is filed apart from the rest because it can lead a Commander deck.
 */
export const COLLECTION_GROUPS = [
  'legendary_creature',
  'creature',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'land',
] as const;

export type CollectionGroup = (typeof COLLECTION_GROUPS)[number];

export const COLLECTION_GROUP_LABELS: Record<CollectionGroup, string> = {
  legendary_creature: 'Legendary creatures',
  creature: 'Creatures',
  planeswalker: 'Planeswalkers',
  battle: 'Battles',
  instant: 'Instants',
  sorcery: 'Sorceries',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  land: 'Lands',
};

/** The group a card is shown under, from its front face's types. */
export function collectionGroup(typeLine: string): CollectionGroup {
  const category = cardCategory(typeLine);
  if (category !== 'creature') return category;
  const front = typeLine.split(' // ')[0] ?? typeLine;
  const supertypes = (front.split('—')[0] ?? front).toLowerCase();
  return supertypes.includes('legendary') ? 'legendary_creature' : 'creature';
}

export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

/** A card needs at least this many colours to count as multicolour. */
const MULTICOLOR_MIN_COLORS = 2;

export interface ColorFilter {
  colors: ReadonlySet<ManaColor>;
  colorless: boolean;
  multicolor: boolean;
}

export const NO_COLOR_FILTER: ColorFilter = { colors: new Set(), colorless: false, multicolor: false };

/**
 * Whether a card's colour identity passes the colour toggles (owner decisions, 2026-09-21):
 *
 * - Nothing toggled: every card.
 * - Multicolor off: the card's colours must all be among the toggled ones. Red + White shows mono-red, mono-white and
 *   red-white cards, not red-black. Colorless adds the cards with no colours.
 * - Multicolor on: only multicolour cards, and each must include every toggled colour. Multicolor + Red + White +
 *   Black shows cards with at least those three; red-white alone is out. Multicolor with no colours toggled shows every
 *   multicolour card. Colorless still adds the colourless cards.
 */
export function matchesColors(identity: ColorIdentity, filter: ColorFilter): boolean {
  const { colors, colorless, multicolor } = filter;
  if (colors.size === 0 && !colorless && !multicolor) return true;
  if (identity === '') return colorless;
  const own = [...identity] as ManaColor[];
  if (multicolor) return own.length >= MULTICOLOR_MIN_COLORS && [...colors].every((c) => own.includes(c));
  return colors.size > 0 && own.every((c) => colors.has(c));
}

/**
 * Whether a card matches the search box: every word must appear in the card's name or in one of its tags, so
 * "draw instant" finds instants that draw. Case-insensitive; an empty query matches everything.
 */
export function matchesSearch(name: string, tags: readonly string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystacks = [name.toLowerCase(), ...tags.map((t) => t.toLowerCase())];
  return words.every((word) => haystacks.some((h) => h.includes(word)));
}

/** Scryfall set types that count as major releases; everything else (promos, Secret Lair, tokens) is "Other". */
export const MAJOR_SET_TYPES: ReadonlySet<string> = new Set(['expansion', 'core', 'masters', 'draft_innovation', 'commander']);

/** The set filter: every card, one major set, or anything printed only outside the major sets. */
export type SetFilter = { kind: 'all' } | { kind: 'set'; code: string } | { kind: 'other' };

/**
 * Whether a card passes the set filter, from the sets of the printings owned. A card owned in several printings
 * matches each of their sets. A card matched by name alone has no printing and so matches only "all sets".
 */
export function matchesSet(setCodes: readonly string[], filter: SetFilter, majorCodes: ReadonlySet<string>): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'set') return setCodes.includes(filter.code);
  return setCodes.some((code) => !majorCodes.has(code));
}

/** Major sets from those given, newest first, for the set filter's list. */
export function majorSetsNewestFirst(sets: readonly CardSet[]): CardSet[] {
  return sets
    .filter((s) => MAJOR_SET_TYPES.has(s.setType))
    .toSorted((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.name.localeCompare(b.name));
}
export * from './edit';
