"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CueRect } from "./tour-cues";

/** The bubble's arrow: a 12 px square turned on its corner, half of it showing past the bubble's edge. */
const ARROW_PX = 12;
/** Keeps the bubble this far inside the screen's edges: the page's own side gutter. */
const VIEWPORT_GUTTER_PX = 16;
/** How close the arrow may come to the bubble's corner. */
const ARROW_INSET_PX = 18;

const TOUR_BUTTON = "min-h-11 min-w-11 px-3";

interface Placement {
  top: number;
  left: number;
  /** The arrow's centre along the bubble's top or bottom edge; null when the bubble sits over the element. */
  arrow: { side: "top" | "bottom"; x: number } | null;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * On the lit area's side nearer the screen's middle (above an element low on the screen, below one high on it), else
 * the other side; when neither fits (the element fills the screen), docked at the screen's foot over it. Centred on the
 * element across, kept inside the gutter.
 */
function place(hole: CueRect, size: { width: number; height: number }, viewport: { width: number; height: number }): Placement {
  const need = size.height + ARROW_PX;
  const below = hole.y + hole.height;
  const left = clamp(hole.x + hole.width / 2 - size.width / 2, VIEWPORT_GUTTER_PX, viewport.width - VIEWPORT_GUTTER_PX - size.width);
  const arrowX = clamp(hole.x + hole.width / 2 - left, ARROW_INSET_PX, size.width - ARROW_INSET_PX);
  const maxTop = viewport.height - VIEWPORT_GUTTER_PX - size.height;
  // An element scrolled off the screen gets the docked bubble until it is back.
  const onScreen = below > 0 && hole.y < viewport.height;
  const fitsBelow = onScreen && below + need <= viewport.height - VIEWPORT_GUTTER_PX;
  const fitsAbove = onScreen && hole.y - need >= VIEWPORT_GUTTER_PX;
  const belowPlacement: Placement = { top: below + ARROW_PX, left, arrow: { side: "top", x: arrowX } };
  const abovePlacement: Placement = { top: hole.y - need, left, arrow: { side: "bottom", x: arrowX } };
  const lowOnScreen = hole.y + hole.height / 2 > viewport.height / 2;
  if (lowOnScreen ? fitsAbove : fitsBelow) return lowOnScreen ? abovePlacement : belowPlacement;
  if (fitsBelow) return belowPlacement;
  if (fitsAbove) return abovePlacement;
  return { top: Math.max(VIEWPORT_GUTTER_PX, maxTop), left, arrow: null };
}

/**
 * The tour's speech bubble: a square paper sheet beside the lit element, with the step's text, its place in the tour,
 * and ‹ Skip ›. Focus moves to it on every step. Positioned off the element's live rect, so it follows the page.
 */
export function TourBubble({
  hole,
  viewport,
  text,
  index,
  count,
  onNext,
  onPrevious,
  onEnd,
}: {
  hole: CueRect;
  viewport: { width: number; height: number };
  text: string;
  index: number;
  count: number;
  onNext: () => void;
  onPrevious: () => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The bubble's own size, read before paint and again whenever its text wraps differently.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [index]);

  const placement = size ? place(hole, size, viewport) : null;
  const style: CSSProperties = placement ? { top: placement.top, left: placement.left } : { top: 0, left: 0, visibility: "hidden" };
  const last = index === count - 1;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Tour"
      tabIndex={-1}
      className="fixed z-60 w-[calc(100vw-2rem)] max-w-80 outline-none"
      style={style}
    >
      {placement?.arrow && (
        // Under the sheet, so only the half past its edge shows.
        <span
          aria-hidden
          className="absolute size-3 -translate-x-1/2 rotate-45 bg-(--paper)"
          style={{ left: placement.arrow.x, [placement.arrow.side]: -ARROW_PX / 2 }}
        />
      )}
      <div className="sheet flex flex-col gap-2 p-4 pb-2">
        <p aria-live="polite" className="text-sm text-foreground">
          {text}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-muted-foreground">
            {index + 1} of {count}
          </span>
          <div className="flex items-center">
            <Button type="button" variant="ghost" className={TOUR_BUTTON} onClick={onEnd}>
              Skip
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={TOUR_BUTTON}
              aria-label="Previous step"
              disabled={index === 0}
              onClick={onPrevious}
            >
              <ChevronLeft aria-hidden className="size-5" />
            </Button>
            <Button type="button" variant="ghost" className={TOUR_BUTTON} aria-label={last ? undefined : "Next step"} onClick={onNext}>
              {last ? "Done" : <ChevronRight aria-hidden className="size-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
