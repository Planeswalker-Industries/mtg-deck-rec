import { STAT_TOLERANCE_MIN_CARDS, STAT_TOLERANCE_SHARE } from "@mtg/core/journey";
import { cn } from "cn";

/** Room past the larger of value and band, so a bar at the band's edge doesn't touch the end of the track. */
const TRACK_HEADROOM = 1.15;
/** Percent of the track a position can take. */
const FULL_TRACK_PCT = 100;

const pct = (n: number, scale: number) => `${Math.max(0, Math.min(FULL_TRACK_PCT, (n / scale) * FULL_TRACK_PCT))}%`;

/**
 * A horizontal bar: the shaded band is the target's tolerance, the fill the deck's value (green in line, gold off),
 * the faint tick where the deck stood when the round started. Numbers sit beside it; the bar itself is decoration.
 */
export function StatBar({ value, target, start, ok }: { value: number; target: number; start: number; ok: boolean }) {
  const reach = Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
  const scale = Math.max(value, start, target + reach, 1) * TRACK_HEADROOM;
  const low = Math.max(0, target - reach);
  return (
    <div aria-hidden className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 bg-foreground/10"
        style={{ left: pct(low, scale), width: pct(target + reach - low, scale) }}
      />
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", ok ? "bg-stat-ok" : "bg-stat-mild")}
        style={{ width: pct(value, scale) }}
      />
      {start !== value && (
        <div className="absolute inset-y-0 w-0.5 bg-muted-foreground/60" style={{ left: pct(start, scale) }} />
      )}
    </div>
  );
}
