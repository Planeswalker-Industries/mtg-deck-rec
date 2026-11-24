"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import type { DeckStatsLevel, StatState } from "@mtg/core/journey";
import { ArrowDown, ArrowRight, ArrowUp, Check, EyeOff, X } from "lucide-react";
import { cn } from "cn";
import { MS_PER_S } from "@/lib/constants";
import { CLOSED_AT_S, LEVEL, ScoreRing, type RingClosing } from "./score-ring";

export { LEVEL };

/** "All rings closed!" fades in and out over this long each way. */
const WORDS_FADE_S = 0.3;
/** It stays up this long between, long enough to read. */
const WORDS_HOLD_S = 1.2;

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
 * Finish's score: the level badge, until every line is in line. Then, once a round (the first time it happens while
 * Finish is up, as the heading comes into view; owner, 2026-11-24), the ring closes into a check, "All rings closed!" fades in and out,
 * leaving the closed ring: its check says it, no second one (owner, 2026-11-23). A deck that falls out of line and
 * back, or reduced motion, shows the closed ring alone at once.
 */
export function FinishScore({
  level,
  okCount,
  total,
  celebrated,
  onCelebrate,
}: {
  level: DeckStatsLevel;
  okCount: number;
  total: number;
  /** The round has celebrated already (an earlier visit to Finish): the closed ring shows at once. */
  celebrated: boolean;
  /** Called as the celebration starts, so the round plays it once. */
  onCelebrate: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const box = useRef<HTMLSpanElement>(null);
  const inView = useInView(box, { once: true });
  const allIn = total > 0 && okCount === total;
  // "live" from the first time every line is in line, "spent" once it no longer is. Adjusted while rendering.
  const [run, setRun] = useState<"fresh" | "live" | "spent">(() => (celebrated ? "spent" : "fresh"));
  if (allIn && run === "fresh") setRun("live");
  if (!allIn && run === "live") setRun("spent");
  const closing: RingClosing = reduceMotion || run !== "live" ? "done" : inView ? "play" : "wait";
  // Beside the ring while it plays: nothing, then the words, then nothing again.
  const [beside, setBeside] = useState<"none" | "words" | "gone">("none");
  const celebrate = useEffectEvent(onCelebrate);
  useEffect(() => {
    if (closing !== "play") return;
    celebrate();
    const toWords = setTimeout(() => setBeside("words"), CLOSED_AT_S * MS_PER_S);
    const toGone = setTimeout(() => setBeside("gone"), (CLOSED_AT_S + WORDS_FADE_S + WORDS_HOLD_S) * MS_PER_S);
    return () => {
      clearTimeout(toWords);
      clearTimeout(toGone);
    };
  }, [closing]);
  const shown = closing === "done" ? "gone" : beside;
  return (
    <span ref={box} className="inline-flex">
      {allIn ? (
        <span className={cn("inline-flex items-center gap-2", LEVEL.ok.text)}>
          <motion.span layout={!reduceMotion} className="inline-flex">
            <ScoreRing level="ok" okCount={okCount} total={total} size="heading" closing={closing} />
          </motion.span>
          <AnimatePresence mode="wait" initial={false}>
            {shown === "words" && (
              <motion.span
                key="words"
                aria-hidden
                className="text-sm font-semibold"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: WORDS_FADE_S }}
              >
                All rings closed!
              </motion.span>
            )}
          </AnimatePresence>
          <span className="sr-only">
            All rings closed, {okCount} of {total} in line
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
