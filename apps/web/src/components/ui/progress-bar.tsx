import { cn } from "cn";

/**
 * A thin progress bar. `value` is percent done, or null while the size of the job is unknown: a third-width pill then
 * sweeps across the track (still, with reduced motion). The fill is ink, not blue: blue only marks what can be pressed.
 */
export function ProgressBar({ value, label, className }: { value: number | null; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-seam", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-foreground/70",
          value === null ? "w-1/3 motion-safe:animate-progress-sweep" : "transition-[width] duration-500 ease-out",
        )}
        style={value === null ? undefined : { width: `${value}%` }}
      />
    </div>
  );
}
