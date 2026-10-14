import { STAT_TOLERANCE_MIN_CARDS, STAT_TOLERANCE_SHARE } from "@mtg/core/journey";
import { cn } from "cn";

/** Room past the larger of value and band, so a bar at the band's edge doesn't touch the end of the track. */
const TRACK_HEADROOM = 1.15;
/** Percent of the track a position can take. */
const FULL_TRACK_PCT = 100;

const pct = (n: number, scale: number) => `${Math.max(0, Math.min(FULL_TRACK_PCT, (n / scale) * FULL_TRACK_PCT))}%`;

/** The stripes on a previewed piece of the bar: the card on screen would add it, or take it away. */
const STRIPES = "repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 4px)";

/**
 * A horizontal bar: the shaded band is the target's tolerance, the fill the deck's value (ink in line, amber off), the
 * faint tick where the deck stood when the round started. A striped piece shows what the card on screen would change:
 * green when toward the target, red when away. Numbers sit beside it; the bar itself is decoration.
 */
export function StatBar({ value, target, start, ok, preview = 0 }: { value: number; target: number; start: number; ok: boolean; preview?: number }) {
  const reach = Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
  const scale = Math.max(value + Math.max(0, preview), start, target + reach, 1) * TRACK_HEADROOM;
  const low = Math.max(0, target - reach);
  const toward = Math.abs(value + preview - target) < Math.abs(value - target);
  const from = Math.min(value, value + preview);
  return (
    <div aria-hidden className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="absolute inset-y-0 bg-foreground/10"
        style={{ left: pct(low, scale), width: pct(target + reach - low, scale) }}
      />
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", ok ? "bg-muted-foreground/70" : "bg-warning")}
        style={{ width: pct(value, scale) }}
      />
      {preview !== 0 && (
        <div
          className={cn("absolute inset-y-0", toward ? "text-success" : "text-destructive")}
          style={{ left: pct(from, scale), width: pct(Math.abs(preview), scale), backgroundImage: STRIPES }}
        />
      )}
      {start !== value && (
        <div className="absolute inset-y-0 w-0.5 bg-foreground/50" style={{ left: pct(start, scale) }} />
      )}
    </div>
  );
}
