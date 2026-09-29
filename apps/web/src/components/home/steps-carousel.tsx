"use client";

import { Children, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "motion/react";
import { cn } from "cn";

/** Each slide is this share of the carousel's width, so the next one peeks in at the edge. Matches `w-[85%]`. */
const SLIDE_SHARE = 0.85;
/** Space between slides. Matches the track's `gap-3`. */
const SLIDE_GAP_PX = 12;
/** A drag this far, or a flick this fast, moves one slide; anything less settles back. */
const SWIPE_OFFSET_PX = 50;
const SWIPE_VELOCITY_PX_S = 400;
/** How far the track gives past its first and last slide while dragging, as a share of the drag. */
const DRAG_ELASTIC = 0.15;
/** Slide changes ease out: quick to follow the finger, gentle to settle. */
const STEP_SLIDE_S = 0.35;

/**
 * A phone-sized carousel: one slide at a time with the next peeking in, moved by swipe or drag (Motion) or by the step
 * buttons above it, which also show where you are. No auto-advance: the slides are read, not glanced at.
 *
 * `labels` names each slide for its button ("Step 1: Import your collection").
 */
export function StepsCarousel({ labels, children }: { labels: string[]; children: ReactNode }) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // The last slide sits flush right rather than leaving an empty strip after it.
  const slideWidth = width * SLIDE_SHARE;
  const maxShift = Math.max(0, count * slideWidth + (count - 1) * SLIDE_GAP_PX - width);
  const target = -Math.min(index * (slideWidth + SLIDE_GAP_PX), maxShift);
  const duration = reduceMotion ? 0 : STEP_SLIDE_S;

  useEffect(() => {
    const controls = animate(x, target, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [x, target, duration]);

  const go = (next: number) => setIndex(Math.max(0, Math.min(count - 1, next)));

  const onDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    if (info.offset.x < -SWIPE_OFFSET_PX || info.velocity.x < -SWIPE_VELOCITY_PX_S) go(index + 1);
    else if (info.offset.x > SWIPE_OFFSET_PX || info.velocity.x > SWIPE_VELOCITY_PX_S) go(index - 1);
    // Same slide (or already at an end): the target hasn't changed, so settle back by hand.
    else animate(x, target, { duration, ease: "easeOut" });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = Math.max(0, Math.min(count - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
    buttonRefs.current[next]?.focus();
    go(next);
  };

  return (
    <section aria-roledescription="carousel" aria-label="Steps">
      <div role="group" aria-label="Choose a step" className="mb-3 flex gap-2" onKeyDown={onKeyDown}>
        {labels.map((label, i) => (
          <button
            key={label}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            aria-label={label}
            aria-current={i === index}
            onClick={() => go(i)}
            className={cn(
              "flex size-8 items-center justify-center rounded-sm border text-sm font-bold tabular-nums transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              i === index ? "border-primary text-primary" : "border-seam text-muted-foreground",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div ref={viewportRef} className="overflow-hidden">
        <motion.div
          className="flex gap-3"
          style={{ x, touchAction: "pan-y" }}
          drag="x"
          dragConstraints={{ left: -maxShift, right: 0 }}
          dragElastic={DRAG_ELASTIC}
          onDragEnd={onDragEnd}
        >
          {slides.map((slide, i) => (
            <div
              key={labels[i]}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              className="w-[85%] shrink-0"
            >
              {slide}
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
