export type AdSlotName = "leaderboard" | "rail" | "in-content";

/** Empty in the POC. Enabling a slot here must not require layout changes elsewhere. */
const ENABLED_SLOTS: ReadonlySet<AdSlotName> = new Set();

/**
 * Fixed positions for future display ads.
 * When ads land, reserve each slot's dimensions here so pages don't shift (CLS).
 */
export function AdSlot({ slot }: { slot: AdSlotName }) {
  if (!ENABLED_SLOTS.has(slot)) return null;
  return <aside data-ad-slot={slot} aria-label="Advertisement" />;
}
