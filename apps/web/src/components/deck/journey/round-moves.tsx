import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "cn";

/** Closer to the aim (better), further (worse), unchanged, or changed with nothing to judge it by. */
export type Verdict = "better" | "worse" | "same" | "neutral";

export function judge(before: number, after: number, target: number | null): Verdict {
  if (after === before) return "same";
  if (target === null) return "neutral";
  return Math.abs(after - target) < Math.abs(before - target) ? "better" : "worse";
}

const VERDICT_TEXT: Record<Verdict, string> = { better: "text-add", worse: "text-cut", same: "text-muted-foreground", neutral: "text-foreground" };

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
