/** Deck stats' first-time hint ("Close every ring."): shown until a player has seen it once in this browser. */
const RING_HINT_KEY = "mtg-deck-rec:ring-hint-seen";

/** Stored once the hint has been on screen. */
const SEEN = "1";

/** Whether this browser has shown the hint. Blocked storage reads as not seen, so the hint still shows. */
export function readRingHintSeen(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(RING_HINT_KEY) === SEEN;
  } catch {
    return false;
  }
}

export function markRingHintSeen(): void {
  try {
    localStorage.setItem(RING_HINT_KEY, SEEN);
  } catch {
    // Storage is blocked; the hint will show again next time.
  }
}
