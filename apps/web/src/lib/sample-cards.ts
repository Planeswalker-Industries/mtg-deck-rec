import { mockCards } from "@mtg/core/mocks";
import type { CardSummary } from "@mtg/core/contract";

/**
 * A card from the checked-in fixtures, for the landing page's illustrations. Fixtures, not the catalog, so those
 * render with the database down and in CI. Throws at build time if a name drifts out of the fixtures.
 */
export function sampleCard(name: string): CardSummary {
  const card = mockCards.find((c) => c.name === name);
  if (!card) throw new Error(`Sample card missing from fixtures: ${name}`);
  return card;
}
