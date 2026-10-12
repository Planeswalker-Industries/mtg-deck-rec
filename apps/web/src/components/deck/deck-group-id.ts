import type { DeckEntry, DeckGroup } from "@mtg/core/scoring";

/** Within a type, cheapest first, then by name, the order a hand of the deck would be sorted in. */
export const byCost = (entries: readonly DeckEntry[]) =>
  [...entries].sort((a, b) => a.card.manaValue - b.card.manaValue || a.card.name.localeCompare(b.card.name));

/** Tagger labels are lowercase ("spot removal"); a heading reads better capitalised. */
export const groupHeading = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/**
 * The heading's element id, which the sidebar's section nav links to.
 *
 * Group keys are card types and Tagger labels, so they carry spaces and punctuation; a fragment link needs an id it
 * can address, and two groups never share a key.
 */
export const groupId = (group: DeckGroup) => `deck-group-${group.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
