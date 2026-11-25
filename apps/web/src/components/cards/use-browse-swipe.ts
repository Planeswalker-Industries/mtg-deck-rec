"use client";

import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { notifyTour } from "@/components/tour/tour-provider";

/** How far a finger has to travel for a swipe to browse: past a stray wobble, under half a phone card. */
const BROWSE_SWIPE_MIN_PX = 48;
/** A quick flick browses even when it is short. */
const BROWSE_FLICK_PX_PER_MS = 0.5;
/** How long a short swipe takes to spring back; matches `duration-180` on buttons. */
const SPRING_BACK_MS = 180;
/** Travel before a drag counts as horizontal or vertical: a finger's first few pixels go any way. */
const DIRECTION_SLOP_PX = 8;
/** How far a drag toward a side with nothing there follows the finger, so it reads as the end of the list. */
const END_RESISTANCE = 0.25;

interface Drag {
  pointerId: number;
  x: number;
  y: number;
  at: number;
  horizontal: boolean;
}

/**
 * A horizontal swipe that browses a list of cards: left shows the next card, right the previous. Touch and pen only;
 * a mouse keeps its clicks and the arrow keys. The bound element follows the finger, a mostly vertical drag is left to
 * the page to scroll (`touch-pan-y`), and a short drag, or one toward a side with nothing there, springs back.
 *
 * `tourTarget` names the element's `data-tour` id: a swipe that browses tells the tours (`notifyTour`).
 */
export function useBrowseSwipe({
  onNext,
  onPrevious,
  canNext,
  canPrevious,
  tourTarget,
}: {
  onNext: () => void;
  onPrevious: () => void;
  canNext: boolean;
  canPrevious: boolean;
  tourTarget?: string;
}) {
  const drag = useRef<Drag | null>(null);
  // A swipe ends with a pointerup over the card, which would also fire a click on whatever is under the finger.
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    drag.current = null;
    setDx(0);
    setDragging(false);
  };

  const bind = {
    onPointerDownCapture: (e: PointerEvent) => {
      swiped.current = false;
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, horizontal: false };
    },
    onPointerMove: (e: PointerEvent) => {
      const start = drag.current;
      if (!start || start.pointerId !== e.pointerId) return;
      const moveX = e.clientX - start.x;
      const moveY = e.clientY - start.y;
      if (!start.horizontal) {
        if (Math.max(Math.abs(moveX), Math.abs(moveY)) < DIRECTION_SLOP_PX) return;
        // A mostly vertical drag is a scroll, not a swipe.
        if (Math.abs(moveY) > Math.abs(moveX)) {
          reset();
          return;
        }
        start.horizontal = true;
        setDragging(true);
      }
      const blocked = (moveX < 0 && !canNext) || (moveX > 0 && !canPrevious);
      setDx(blocked ? moveX * END_RESISTANCE : moveX);
    },
    onPointerUp: (e: PointerEvent) => {
      const start = drag.current;
      if (!start || start.pointerId !== e.pointerId) return;
      const moveX = e.clientX - start.x;
      const elapsed = Math.max(1, e.timeStamp - start.at);
      const far = Math.abs(moveX) >= BROWSE_SWIPE_MIN_PX;
      const flick = start.horizontal && Math.abs(moveX) / elapsed >= BROWSE_FLICK_PX_PER_MS;
      reset();
      if (!start.horizontal || !(far || flick)) return;
      swiped.current = true;
      const browsed = moveX < 0 ? canNext : canPrevious;
      if (!browsed) return;
      if (moveX < 0) onNext();
      else onPrevious();
      if (tourTarget) notifyTour(tourTarget, "swipe");
    },
    onPointerCancel: reset,
    onClickCapture: (e: MouseEvent) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    style: {
      transform: dx === 0 ? undefined : `translateX(${dx}px)`,
      transition: dragging ? "none" : `transform ${SPRING_BACK_MS}ms ease-out`,
    } satisfies CSSProperties,
    className: "touch-pan-y",
  };

  return { bind };
}

/** What `useBrowseSwipe` binds to the swiped element: spread it on the element, `className` merged with its own. */
export type BrowseSwipeBind = ReturnType<typeof useBrowseSwipe>["bind"];
