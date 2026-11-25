"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "@/lib/tours";
import { TourBubble } from "./tour-bubble";
import { SwipeArrow, TapPulse, type CueRect } from "./tour-cues";
import { covered, liveTarget, type LiveTarget } from "./tour-dom";

/** How far the lit hole reaches past its element, so its ring clears the element's edge. */
const TOUR_CUTOUT_PAD_PX = 8;
/** A rect that moved less than this is the same rect: no re-render for sub-pixel jitter. */
const RECT_EPSILON_PX = 0.5;
/** An element taller than this share of the screen scrolls to its top, so the bubble keeps the rest; others centre. */
const TALL_TARGET_SHARE = 0.5;

interface Frame {
  /** The element's own rect, for the cues. */
  rect: CueRect;
  /** The lit hole: the rect plus the pad, its corners the element's own radius plus the pad. */
  hole: CueRect & { radius: number };
  viewport: { width: number; height: number };
  /** An open dialog or list that doesn't hold the element is over the page: the overlay stands aside for it. */
  covered: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < RECT_EPSILON_PX;
const sameFrame = (a: Frame | null, b: Frame) =>
  a !== null &&
  a.covered === b.covered &&
  near(a.rect.x, b.rect.x) &&
  near(a.rect.y, b.rect.y) &&
  near(a.rect.width, b.rect.width) &&
  near(a.rect.height, b.rect.height) &&
  near(a.viewport.width, b.viewport.width) &&
  near(a.viewport.height, b.viewport.height);

function measure(element: HTMLElement, radius: number): Frame {
  const { left, top, width, height } = element.getBoundingClientRect();
  return {
    rect: { x: left, y: top, width, height },
    hole: {
      x: left - TOUR_CUTOUT_PAD_PX,
      y: top - TOUR_CUTOUT_PAD_PX,
      width: width + 2 * TOUR_CUTOUT_PAD_PX,
      height: height + 2 * TOUR_CUTOUT_PAD_PX,
      // A square-cornered element (a sheet) keeps square corners; a rounded one keeps its curve around the pad.
      radius: radius > 0 ? radius + TOUR_CUTOUT_PAD_PX : 0,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    covered: covered(element),
  };
}

/** The screen as one rect, minus the hole: drawn even-odd, so the hole is empty and takes no taps. */
function scrimPath({ hole, viewport }: Frame): string {
  const { x, y, width: w, height: h } = hole;
  const r = Math.min(hole.radius, w / 2, h / 2);
  const screen = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  const cut =
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `${screen}${cut}`;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Draws a tour's step: the page dimmed except for its element, a ring echoing out from it, the step's cue (a tap pulse
 * or a swipe arrow) and the bubble. The dimmed area takes taps and drops them; the lit element works as usual. Every
 * measure is the element's live rect, read each frame, so the hole follows scrolling, resizing and the page reflowing.
 * An element that leaves the page is looked for once more (or a stand-in); gone, the step is skipped.
 */
export function TourOverlay({
  step,
  title,
  index,
  count,
  onNext,
  onPrevious,
  onEnd,
  onOpen,
}: {
  step: TourStep;
  title: string;
  index: number;
  count: number;
  onNext: () => void;
  onPrevious: () => void;
  onEnd: () => void;
  /** Called when the overlay shows, so the provider can note where focus was. */
  onOpen: () => void;
}) {
  // The step's element, found again whenever the step changes (during render, so the frame never lights a stale one).
  const [resolved, setResolved] = useState<{ step: TourStep; live: LiveTarget | null }>(() => ({ step, live: liveTarget(step) }));
  if (resolved.step !== step) setResolved({ step, live: liveTarget(step) });
  const live = resolved.step === step ? resolved.live : null;
  const [frame, setFrame] = useState<Frame | null>(null);
  const frameRef = useRef<Frame | null>(null);
  // The latest handlers, for listeners set up once per step.
  const handlers = useRef({ onNext, onEnd });
  useLayoutEffect(() => {
    handlers.current = { onNext, onEnd };
  });

  // The provider notes where focus was, and puts it back there when the tour ends.
  useEffect(() => {
    onOpen();
  }, [onOpen]);

  // A new step: bring its element into view; none on the page, and the step is skipped.
  const stepElement = resolved.live?.element;
  const stepFound = resolved.step === step;
  useLayoutEffect(() => {
    if (!stepFound) return;
    if (!stepElement) {
      handlers.current.onNext();
      return;
    }
    const tall = stepElement.getBoundingClientRect().height > window.innerHeight * TALL_TARGET_SHARE;
    stepElement.scrollIntoView({ block: tall ? "start" : "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [step, stepFound, stepElement]);

  // Follow the element every frame; when it leaves, look once more (it may have been replaced), else skip the step.
  // The first measure runs before paint, so a new step's text never shows for a frame where the last step's bubble was.
  const element = live?.element;
  // What the lit element asks for: a stand-in can ask for something else than its step.
  const prompt = live?.prompt ?? step.prompt;
  useLayoutEffect(() => {
    if (!element) return;
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    let id = 0;
    const tick = () => {
      if (!element.isConnected) {
        const again = liveTarget(step);
        if (again) setResolved({ step, live: again });
        else handlers.current.onNext();
        return;
      }
      const next = measure(element, radius);
      if (!sameFrame(frameRef.current, next)) {
        frameRef.current = next;
        setFrame(next);
      }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [element, step]);

  // A tap step moves on once the element's own click handler has run. A select opens on the press itself and takes
  // the release, so no click reaches the element: a press that opens a list over it counts as the tap too.
  // A quick click can do both (the layer is open by the frame after the press), so the step moves on once.
  useEffect(() => {
    if (!element || prompt !== "tap") return;
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      handlers.current.onNext();
    };
    const onClick = () => setTimeout(once);
    const onPress = () =>
      requestAnimationFrame(() => {
        if (covered(element)) once();
      });
    element.addEventListener("click", onClick, { capture: true });
    element.addEventListener("pointerdown", onPress, { capture: true });
    return () => {
      element.removeEventListener("click", onClick, { capture: true });
      element.removeEventListener("pointerdown", onPress, { capture: true });
    };
  }, [element, prompt, step]);

  const standAside = frame?.covered ?? true;
  // Esc ends the tour, unless it belongs to a dialog or list the player opened over it.
  useEffect(() => {
    if (standAside) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handlers.current.onEnd();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [standAside]);

  if (!frame || !live || standAside) return null;
  const { hole } = frame;
  return createPortal(
    <div data-tour-overlay="">
      <svg aria-hidden className="pointer-events-none fixed inset-0 z-60 size-full">
        <path d={scrimPath(frame)} fillRule="evenodd" className="pointer-events-auto fill-(--tour-scrim)" />
      </svg>
      {/* The lit area's brass ring, with its echo rippling out. */}
      <span
        aria-hidden
        data-tour-ring=""
        className="pointer-events-none fixed z-60 border-2 border-(--brass-light)"
        style={{ left: hole.x, top: hole.y, width: hole.width, height: hole.height, borderRadius: hole.radius }}
      >
        <span
          className="absolute -inset-0.5 animate-tour-echo outline-2 outline-(--brass-light) motion-reduce:animate-none motion-reduce:opacity-0"
          style={{ borderRadius: hole.radius }}
        />
      </span>
      {prompt === "tap" && <TapPulse rect={frame.rect} />}
      {prompt === "swipe" && <SwipeArrow rect={frame.rect} direction={step.swipe ?? "horizontal"} />}
      <TourBubble
        hole={hole}
        viewport={frame.viewport}
        text={live.text}
        title={title}
        index={index}
        count={count}
        onNext={onNext}
        onPrevious={onPrevious}
        onEnd={onEnd}
      />
    </div>,
    document.body,
  );
}
