"use client";

import { motion } from "motion/react";
import { Check, CircleAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import type { DeckStatsLevel } from "@mtg/core/journey";
import { cn } from "cn";
import { EASE_SINE, ICON_STROKE_BOLD, ICON_STROKE_HEAVY, RING_CHECK_GROW } from "@/lib/constants";

/**
 * The deck's score as one ring (owner, 2026-11-23): a segment per counted line, filled in the level's colour for each
 * line in line, the level's icon in the middle so the colour never stands alone. It sits in the docked bar, the sheet's
 * header, the rail and Finish's heading, beside the "8/16" count. Finish can close it: the segments fill one after
 * another, the gaps close into one ring, and a check grows in.
 */

/** Each level's icon, word and colour: the colour never stands alone. */
export const LEVEL: Record<DeckStatsLevel, { icon: LucideIcon; word: string; text: string }> = {
  ok: { icon: Check, word: "OK", text: "text-stat-ok" },
  mild: { icon: TriangleAlert, word: "Mild", text: "text-stat-mild" },
  urgent: { icon: CircleAlert, word: "Urgent", text: "text-stat-urgent" },
};

/** Ring diameters in px: the docked bar (24 at most, so the bar keeps its height), and headings. */
const RING_PX = { dock: 24, heading: 32 } as const;
/** Ring stroke widths in px, at the same sizes. */
const STROKE_PX = { dock: 3, heading: 4 } as const;
/** The gap between two segments, in px along the ring. */
const GAP_PX = 2;
/** A gap never takes more than this share of a segment's slot, so a deck with many lines still shows its segments. */
const MAX_GAP_SHARE = 0.4;
const FULL_TURN_DEG = 360;
const HALF_TURN_DEG = 180;
/** SVG angles start at three o'clock; the ring starts at twelve. */
const TOP_DEG = -90;
/** Coordinates rounded to this many decimals, so the server and the client draw the same path. */
const PATH_DECIMALS = 3;
/** The closing: how long the segments take to fill, all together, one after another, each on a sine curve. */
const CLOSE_FILL_S = 0.8;
/** Then the gaps close into one ring this fast. */
const CLOSE_SEAL_S = 0.25;
/** Then the check grows in over this long. */
const CLOSE_CHECK_S = 0.35;
/** When the ring has closed: its check has grown in. */
export const CLOSED_AT_S = CLOSE_FILL_S + CLOSE_SEAL_S + CLOSE_CHECK_S;

type ScoreRingSize = keyof typeof RING_PX;

/** Where a closing ring is: not yet in view (empty), filling, or closed (shown at once under reduced motion). */
export type RingClosing = "wait" | "play" | "done";

function point(c: number, r: number, deg: number): string {
  const rad = ((deg + TOP_DEG) * Math.PI) / HALF_TURN_DEG;
  return `${(c + r * Math.cos(rad)).toFixed(PATH_DECIMALS)} ${(c + r * Math.sin(rad)).toFixed(PATH_DECIMALS)}`;
}

/** One segment's arc, clockwise from `from` to `to` degrees past twelve o'clock. */
function arcPath(c: number, r: number, from: number, to: number): string {
  const large = to - from > HALF_TURN_DEG ? 1 : 0;
  return `M ${point(c, r, from)} A ${r} ${r} 0 ${large} 1 ${point(c, r, to)}`;
}

/** The segments' arcs, a gap between each two. */
function segments(total: number, c: number, r: number): string[] {
  const slot = FULL_TURN_DEG / total;
  const gapDeg = Math.min((GAP_PX / r) * (HALF_TURN_DEG / Math.PI), slot * MAX_GAP_SHARE);
  return Array.from({ length: total }, (_, i) => arcPath(c, r, i * slot + gapDeg / 2, (i + 1) * slot - gapDeg / 2));
}

/**
 * The score ring alone, hidden from screen readers: its caller says the score in words. `closing` draws Finish's
 * payoff when every line is in line.
 */
export function ScoreRing({
  okCount,
  total,
  level,
  size,
  closing,
}: {
  okCount: number;
  total: number;
  level: DeckStatsLevel;
  size: ScoreRingSize;
  closing?: RingClosing;
}) {
  const { icon: Icon, text } = LEVEL[level];
  const px = RING_PX[size];
  const stroke = STROKE_PX[size];
  const c = px / 2;
  const r = (px - stroke) / 2;
  const arcs = total > 0 ? segments(total, c, r) : [];
  const playing = closing === "wait" || closing === "play";
  const run = closing === "play";
  const step = total > 0 ? CLOSE_FILL_S / total : 0;
  const iconClass = size === "dock" ? "size-3" : "size-4";

  return (
    <span aria-hidden className={cn("relative inline-flex shrink-0 items-center justify-center", text)} style={{ width: px, height: px }}>
      <svg width={px} height={px} className="absolute inset-0" fill="none" strokeWidth={stroke}>
        {arcs.map((d, i) => (
          <path key={`seam-${i}`} d={d} className="stroke-seam" />
        ))}
        {arcs
          .slice(0, okCount)
          .map((d, i) =>
            playing ? (
              <motion.path
                key={`ok-${i}`}
                d={d}
                stroke="currentColor"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: run ? 1 : 0, opacity: run ? 1 : 0 }}
                transition={{ duration: step, delay: i * step, ease: EASE_SINE }}
              />
            ) : (
              <path key={`ok-${i}`} d={d} stroke="currentColor" />
            ),
          )}
        {/* Closed: the gaps close into one ring. */}
        {closing === "done" && <circle cx={c} cy={c} r={r} stroke="currentColor" />}
        {playing && (
          <motion.circle
            cx={c}
            cy={c}
            r={r}
            stroke="currentColor"
            initial={{ opacity: 0 }}
            animate={{ opacity: run ? 1 : 0 }}
            transition={{ duration: CLOSE_SEAL_S, delay: CLOSE_FILL_S }}
          />
        )}
      </svg>
      {playing ? (
        <motion.span
          className="relative"
          initial={{ opacity: 0, scale: RING_CHECK_GROW[0] }}
          animate={run ? { opacity: 1, scale: RING_CHECK_GROW } : { opacity: 0, scale: RING_CHECK_GROW[0] }}
          transition={{ duration: CLOSE_CHECK_S, delay: CLOSE_FILL_S + CLOSE_SEAL_S, ease: "easeOut" }}
        >
          <Icon className={iconClass} strokeWidth={ICON_STROKE_HEAVY} />
        </motion.span>
      ) : (
        <Icon className={cn("relative", iconClass)} strokeWidth={closing === "done" ? ICON_STROKE_HEAVY : ICON_STROKE_BOLD} />
      )}
    </span>
  );
}
