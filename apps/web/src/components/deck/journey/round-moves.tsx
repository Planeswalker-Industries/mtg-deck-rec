import { ArrowDown, ArrowUp, Check } from "lucide-react";
import type { StatLine } from "@mtg/core/journey";
import { cn } from "cn";

/** Room past the largest of start, now and aim on each track, so the aim tick never sits on the right edge. */
const TRACK_HEADROOM = 1.25;

/** Closer to the aim (better), further (worse), unchanged, or changed with nothing to judge it by. */
export type Verdict = "better" | "worse" | "same" | "neutral";

export function judge(before: number, after: number, target: number | null): Verdict {
  if (after === before) return "same";
  if (target === null) return "neutral";
  return Math.abs(after - target) < Math.abs(before - target) ? "better" : "worse";
}

const VERDICT_TEXT: Record<Verdict, string> = { better: "text-add", worse: "text-cut", same: "text-muted-foreground", neutral: "text-foreground" };
const VERDICT_FILL: Record<Verdict, string> = { better: "bg-add", worse: "bg-cut", same: "bg-muted-foreground", neutral: "bg-foreground/70" };
const VERDICT_WORD: Record<Verdict, string> = { better: "closer to the aim", worse: "further from the aim", same: "unchanged", neutral: "changed" };

/** Before → after in DM Mono, with an arrow that carries the verdict's colour (never the colour alone). */
export function Move({ before, after, verdict, format = String }: { before: number; after: number; verdict: Verdict; format?: (n: number) => string }) {
  const Arrow = verdict === "same" ? null : after > before ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1 font-mono whitespace-nowrap tabular-nums">
      {verdict !== "same" && <span className="text-muted-foreground">{format(before)} →</span>}
      <span className={cn(verdict !== "same" && VERDICT_TEXT[verdict])}>{format(after)}</span>
      {Arrow && <Arrow aria-hidden className={cn("size-3.5", VERDICT_TEXT[verdict])} />}
    </span>
  );
}

/**
 * One stat line as a track: a hollow ring where the round started, a filled dot where it ends, the stretch between in
 * the verdict's colour, and a tick at the aim. Seen together the rows show at a glance which lines the round moved and
 * whether toward the aim, even when a line moved down on purpose (11 card advantage against an aim of 11).
 */
function Track({ line }: { line: StatLine }) {
  const verdict = judge(line.start, line.value, line.target);
  const max = Math.max(line.start, line.value, line.target) * TRACK_HEADROOM || 1;
  const at = (n: number) => `${(n / max) * 100}%`;
  const low = Math.min(line.start, line.value);
  const high = Math.max(line.start, line.value);
  return (
    <div aria-hidden className="relative h-4">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-seam" />
      {verdict !== "same" && (
        <div className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full", VERDICT_FILL[verdict])} style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      )}
      <div className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60" style={{ left: at(line.target) }} />
      {verdict !== "same" && (
        <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-background" style={{ left: at(line.start) }} />
      )}
      <div className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background", VERDICT_FILL[verdict])} style={{ left: at(line.value) }} />
    </div>
  );
}

/**
 * The round's stat lines, one compact row each: label, track, numbers against the aim. On a phone the track gets a line
 * of its own under the label and numbers, so it stays long enough to read.
 */
export function RoundMoves({ lines }: { lines: readonly StatLine[] }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:gap-y-2.5">
      {lines.map((line) => {
        const verdict = judge(line.start, line.value, line.target);
        return (
          <li key={line.key} className="col-span-2 grid grid-cols-subgrid items-center gap-y-0.5 sm:col-span-3">
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              {line.ok ? <Check aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : <span aria-hidden className="w-3.5 shrink-0" />}
              <span className="truncate">{line.label}</span>
            </span>
            {/* Under the label and numbers on a phone, between them on a wider screen. */}
            <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <Track line={line} />
            </div>
            <span className="col-start-2 row-start-1 flex items-baseline justify-end gap-2 text-sm sm:col-start-3">
              <Move before={line.start} after={line.value} verdict={verdict} />
              <span className="font-mono text-xs text-muted-foreground tabular-nums">/ {Math.round(line.target)}</span>
              <span className="sr-only">
                , aim {Math.round(line.target)}, {verdict === "same" ? "unchanged" : `was ${line.start}, ${VERDICT_WORD[verdict]}`}
                {line.ok ? ", in line" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
