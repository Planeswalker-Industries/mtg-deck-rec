import type { DeckGroup } from "@mtg/core/scoring";

/** Tagger labels are lowercase ("spot removal"); a heading reads better capitalised. */
export const groupHeading = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/**
 * The heading's element id, which the sidebar's section nav links to.
 *
 * Group keys are card types and Tagger labels, so they carry spaces and punctuation; a fragment link needs an id it
 * can address, and two groups never share a key.
 */
export const groupId = (group: DeckGroup) => `deck-group-${group.key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
