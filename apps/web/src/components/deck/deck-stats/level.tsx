"use client";

import { useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import type { DeckStatsLevel, StatState } from "@mtg/core/journey";
import { ArrowDown, ArrowRight, ArrowUp, Check, EyeOff, X } from "lucide-react";
import { cn } from "cn";
import { CLOSE_WORDS_DELAY_S, LEVEL, ScoreRing, type RingClosing } from "./score-ring";

export { LEVEL };

/** The closing's words fade in over this long. */
const CLOSE_WORDS_S = 0.3;

/**
 * A Deck stats line's mark: a green check in line, a red X off, or a grey eye when the player chose to ignore the line
 * (left out of the score). Every line in the sheet and the rail starts with one, the Budget row included.
 */
export function Mark({ state }: { state: StatState }) {
  if (state === "ignored") return <EyeOff role="img" aria-label="Ignored" className="size-4 shrink-0 text-muted-foreground" />;
  return state === "ok" ? (
    <Check role="img" aria-label="OK" className="size-4 shrink-0 text-success" />
  ) : (
    <X role="img" aria-label="Off" className="size-4 shrink-0 text-destructive" />
  );
}

/** `compact`: the ring and count only (the docked bar); the word stays for screen readers. */
export function LevelBadge({
  level,
  okCount,
  total,
  compact = false,
}: {
  level: DeckStatsLevel;
  okCount: number;
  total: number;
  compact?: boolean;
}) {
  const { word, text } = LEVEL[level];
  return (
    <span className={`inline-flex items-center gap-1.5 ${text}`}>
      <ScoreRing level={level} okCount={okCount} total={total} size={compact ? "dock" : "heading"} />
      <span className={compact ? "sr-only" : "text-sm"}>{word}</span>
      <span aria-hidden className="font-mono text-sm text-foreground">
        {okCount}/{total}
      </span>
      <span className="sr-only">
        , {okCount} of {total} in line
      </span>
    </span>
  );
}

/**
 * Finish's score: the level badge, until every line is in line. Then the ring closes into a check beside "All lines in
 * line", once: the first time it happens while Finish is up, as the heading comes into view. A deck that falls out of
 * line and back shows the closed ring at once, and so does reduced motion.
 */
export function FinishScore({ level, okCount, total }: { level: DeckStatsLevel; okCount: number; total: number }) {
  const reduceMotion = useReducedMotion() ?? false;
  const box = useRef<HTMLSpanElement>(null);
  const inView = useInView(box, { once: true });
  const allIn = total > 0 && okCount === total;
  // "live" from the first time every line is in line, "spent" once it no longer is. Adjusted while rendering.
  const [run, setRun] = useState<"fresh" | "live" | "spent">("fresh");
  if (allIn && run === "fresh") setRun("live");
  if (!allIn && run === "live") setRun("spent");
  const closing: RingClosing = reduceMotion || run !== "live" ? "done" : inView ? "play" : "wait";
  return (
    <span ref={box} className="inline-flex">
      {allIn ? (
        <span className={cn("inline-flex items-center gap-2", LEVEL.ok.text)}>
          <ScoreRing level="ok" okCount={okCount} total={total} size="heading" closing={closing} />
          <motion.span
            className="text-sm font-semibold"
            initial={closing === "done" ? false : { opacity: 0 }}
            animate={{ opacity: closing === "wait" ? 0 : 1 }}
            transition={{ duration: CLOSE_WORDS_S, delay: closing === "play" ? CLOSE_WORDS_DELAY_S : 0 }}
          >
            All lines in line
          </motion.span>
          <span className="sr-only">
            , {okCount} of {total}
          </span>
        </span>
      ) : (
        <LevelBadge level={level} okCount={okCount} total={total} />
      )}
    </span>
  );
}

/**
 * "⬇ 8/9": the footer's score with a card on screen (T091), the result alone: green with an up arrow when higher, red
 * with a down arrow when lower. No change reads as the level badge, since the score stays.
 */
export function ScoreResult({ okCount, total, now, level }: { okCount: number; total: number; now: number; level: DeckStatsLevel }) {
  if (okCount === now) return <LevelBadge level={level} okCount={now} total={total} compact />;
  const up = okCount > now;
  const Icon = up ? ArrowUp : ArrowDown;
  const tone = up ? "text-success" : "text-destructive";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-sm", tone)}>
      <Icon aria-hidden className="size-4" strokeWidth={2.75} />
      <span className="sr-only">With this card: </span>
      {okCount}/{total}
      <span className="sr-only">{up ? ", more lines in line" : ", fewer lines in line"}</span>
    </span>
  );
}

/**
 * "→ 4/11": the score answering the card on screen would give, beside the level badge: green with an up arrow when
 * higher, red with a down arrow when lower.
 */
export function ScoreAfter({ okCount, total, now }: { okCount: number; total: number; now: number }) {
  const Icon = okCount > now ? ArrowUp : okCount < now ? ArrowDown : null;
  const tone = okCount > now ? "text-success" : okCount < now ? "text-destructive" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm">
      <ArrowRight aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="sr-only">With this card: </span>
      <span className={tone}>
        {okCount}/{total}
      </span>
      {Icon && <Icon aria-hidden className={cn("size-3.5", tone)} strokeWidth={2.75} />}
      <span className="sr-only">{okCount > now ? ", more lines in line" : okCount < now ? ", fewer lines in line" : ", no change"}</span>
    </span>
  );
}
