/**
 * A short buzz for the Deck stats rings (owner, 2026-11-23): a ring that shakes buzzes, a ring that closes ticks. Only
 * where the Vibration API exists (Android browsers; iOS Safari and most desktops have none) and only once the page has
 * had a tap, since browsers block a vibration before that. Callers skip it under reduced motion.
 */

/** A shake's buzz: long enough to feel, as short as the shake reads. */
const SHAKE_BUZZ_MS = 40;
/** A close's tick: the lightest pulse most phones still render. */
const CLOSE_BUZZ_MS = 12;
/**
 * Quiet needed before the next buzz, counted from the last one asked for (sent or not). Longer than a ring's fill
 * (0.4 s), so a group filling one ring after another ticks once, not once a ring.
 */
const HAPTIC_GAP_MS = 600;

const BUZZ_MS = { shake: SHAKE_BUZZ_MS, close: CLOSE_BUZZ_MS } as const;

let lastAskedAt = Number.NEGATIVE_INFINITY;

export function buzz(kind: keyof typeof BUZZ_MS): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const now = performance.now();
  const quiet = now - lastAskedAt >= HAPTIC_GAP_MS;
  lastAskedAt = now;
  if (!quiet) return;
  // Without a tap first, Chrome refuses and logs a warning: skip it instead.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate(BUZZ_MS[kind]);
}
