"use client";

import type { CSSProperties } from "react";
import { cn } from "cn";

/**
 * The tours' gesture cues, drawn over the lit element. Both are measured off the element's live rect and never take a
 * tap; with reduced motion they hold still.
 */

/** A swipe cue's length against its element: long enough to read as a gesture, short enough to stay inside it. */
const SWIPE_ARROW_WIDTH_RATIO = 0.6;
/** The arrow's stroke box: its height across, and how far each head reaches back along the line. */
const ARROW_THICKNESS_PX = 16;
const ARROW_HEAD_PX = 8;

/** Where the cue sits: the element's rect in viewport pixels. */
export interface CueRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** "Press here": an espresso ring with a paper halo (so it shows on any ground) grows from the centre and fades. */
export function TapPulse({ rect }: { rect: CueRect }) {
  const style: CSSProperties = { left: rect.x + rect.width / 2, top: rect.y + rect.height / 2 };
  return (
    <span aria-hidden className="pointer-events-none fixed z-60 -translate-1/2" style={style}>
      <span className="block size-11 animate-tour-tap rounded-full border-4 border-primary ring-2 ring-(--paper-raised) motion-reduce:animate-none" />
    </span>
  );
}

/** A double-headed arrow on a dark chip with the word SWIPE, drifting the way to swipe. */
export function SwipeArrow({ rect, direction }: { rect: CueRect; direction: "horizontal" | "up" }) {
  const up = direction === "up";
  const length = (up ? rect.height : rect.width) * SWIPE_ARROW_WIDTH_RATIO;
  const mid = ARROW_THICKNESS_PX / 2;
  const line = (
    <svg
      aria-hidden
      width={up ? ARROW_THICKNESS_PX : length}
      height={up ? length : ARROW_THICKNESS_PX}
      className="overflow-visible stroke-(--wood-ink)"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {up ? (
        <path d={`M${mid} ${length} V0 M${mid - ARROW_HEAD_PX} ${ARROW_HEAD_PX} L${mid} 0 L${mid + ARROW_HEAD_PX} ${ARROW_HEAD_PX}`} />
      ) : (
        <path
          d={`M0 ${mid} H${length} M${ARROW_HEAD_PX} ${mid - ARROW_HEAD_PX} L0 ${mid} L${ARROW_HEAD_PX} ${mid + ARROW_HEAD_PX} M${length - ARROW_HEAD_PX} ${mid - ARROW_HEAD_PX} L${length} ${mid} L${length - ARROW_HEAD_PX} ${mid + ARROW_HEAD_PX}`}
        />
      )}
    </svg>
  );
  const style: CSSProperties = { left: rect.x + rect.width / 2, top: rect.y + rect.height / 2 };
  return (
    <span aria-hidden className="pointer-events-none fixed z-60 -translate-1/2" style={style}>
      <span
        className={cn(
          "flex items-center gap-2 rounded-full bg-(--wood-bar)/80 px-3 py-2 text-xs font-semibold tracking-widest text-(--wood-ink) motion-reduce:animate-none",
          // Up: the arrow stands beside the word; across, the word sits under the arrow.
          up ? "animate-tour-drift-up" : "animate-tour-drift flex-col",
        )}
      >
        {line}
        SWIPE
      </span>
    </span>
  );
}
