import { STAT_TOLERANCE_MIN_CARDS, STAT_TOLERANCE_SHARE } from './deck-tally';

/**
 * Where a Deck stats line sits, as a ring reads it (owner, 2026-11-23): far short, short, in its range, or over it.
 * `severe` and `over` are the two bad ends; `low` is short but on its way.
 */
export type RingZone = 'severe' | 'low' | 'ok' | 'over';

/** Below this share of the range's bottom, a short line reads as far short (red rather than amber). */
export const RING_SEVERE_SHARE = 0.5;

export interface StatRing {
  zone: RingZone;
  /** The first lap, 0 to 1: the count toward the bottom of the range. Closed (1) once the line is in range. */
  lap: number;
  /** The second lap, 0 to 1: how far into the range the count sits; full past it. Always 0 for a minimum line. */
  extra: number;
}

const clampUnit = (n: number) => Math.max(0, Math.min(1, n));

/**
 * A line as a ring. The first lap closes at the bottom of the line's range (the target less its tolerance, as
 * `withinTolerance` reads it); the second, darker lap fills across the range and is full at its top; past the top the
 * line is over. A `minimum` line (colour sources) closes at its target and has no top. `ok` is the line's own verdict,
 * so the ring and the score always agree (a colour line rounds its sources down for show but is judged on the exact
 * count).
 */
export function statRing(value: number, target: number, ok: boolean, minimum = false): StatRing {
  const reach = Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
  const low = minimum ? target : Math.max(0, target - reach);
  const high = target + reach;
  if (ok) {
    return { zone: 'ok', lap: 1, extra: minimum ? 0 : clampUnit((value - low) / (high - low)) };
  }
  if (!minimum && value > target) return { zone: 'over', lap: 1, extra: 1 };
  const lap = low > 0 ? clampUnit(value / low) : 0;
  return { zone: value < low * RING_SEVERE_SHARE ? 'severe' : 'low', lap, extra: 0 };
}

const ZONE_RANK: Record<RingZone, number> = { ok: 0, low: 1, severe: 2, over: 2 };

/** True when going from `from` to `to` is a step toward a bad end: the ring shakes. */
export const ringWorsens = (from: RingZone, to: RingZone): boolean => ZONE_RANK[to] > ZONE_RANK[from];

/** The whole-card counts a line is in line at: from `low` up to `high` (null for a minimum line, which has no top). */
export function ringRange(target: number, minimum = false): { low: number; high: number | null } {
  const reach = Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
  return minimum ? { low: Math.ceil(target), high: null } : { low: Math.max(0, Math.ceil(target - reach)), high: Math.floor(target + reach) };
}
