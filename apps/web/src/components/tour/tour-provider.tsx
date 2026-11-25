"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { markTourSeen, tourSeen, toursEnabled } from "@/lib/tour-store";
import { stepTargets, tourSteps, tourTitle, type TourId } from "@/lib/tours";
import { liveTarget, stepReady } from "./tour-dom";
import { TourOverlay } from "./tour-overlay";

/**
 * How long a step waits for its element before it is skipped: long enough for a client read to land and render
 * ("My collection" once the collection loads), short enough that a missing element never holds the tour up.
 */
const TOUR_TARGET_WAIT_MS = 1500;

/** The running tour. `ready` once its step's element is on the page and free to light; `shown` once any step was. */
interface Run {
  id: TourId;
  index: number;
  ready: boolean;
  shown: boolean;
}

interface TourApi {
  /** The step to draw, once its element is ready; null while none is. */
  active: { id: TourId; index: number } | null;
  /** Starts a tour, or queues it behind the one running. Ignored if it was seen, or tours are off. */
  request(id: TourId): void;
  /** Drops a tour whose page went away: out of the queue, or stopped (seen if any step showed). */
  release(id: TourId): void;
  next(): void;
  previous(): void;
  /** Ends the running tour (Skip, Esc, or past the last step) and marks it seen. */
  end(): void;
}

const TourContext = createContext<TourApi | null>(null);

/** The mounted provider's handler for `notifyTour`; there is one provider, in the root layout. */
let notifyHandler: ((target: string, action: "tap" | "swipe") => void) | null = null;

/**
 * Tells the tours the player tapped or swiped an element (by its `data-tour` id). The running tour moves on when that
 * is what its step asked for; otherwise nothing happens.
 */
export function notifyTour(target: string, action: "tap" | "swipe"): void {
  notifyHandler?.(target, action);
}

const startable = (id: TourId) => toursEnabled() && !tourSeen(id) && tourSteps(id).length > 0;

/**
 * Runs one tour at a time across the app. A page asks for its tour with `<PageTour id>`; a second request while one
 * runs waits its turn. Each step waits for its element (and for any dialog over it to close), and is skipped when the
 * element never comes. The overlay that draws `active` sits inside this provider.
 *
 * A step whose element is already free to light shows at once, so moving between steps on one screen never drops the
 * overlay for a frame.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  // The ref is the truth the handlers read and write at once; the state re-renders the overlay.
  const runRef = useRef<Run | null>(null);
  const [run, setRunState] = useState<Run | null>(null);
  const queue = useRef<TourId[]>([]);

  const setRun = useCallback((next: Run | null) => {
    runRef.current = next;
    setRunState(next);
  }, []);

  const close = useCallback(
    (markSeen: boolean) => {
      const current = runRef.current;
      if (!current) return;
      if (markSeen) markTourSeen(current.id);
      let next: Run | null = null;
      while (!next && queue.current.length > 0) {
        const id = queue.current.shift();
        if (id !== undefined && startable(id)) next = { id, index: 0, ready: false, shown: false };
      }
      setRun(next);
    },
    [setRun],
  );

  const goTo = useCallback(
    (index: number) => {
      const current = runRef.current;
      if (!current) return;
      // Past the last step: done, and seen only if the player saw any of it.
      const step = tourSteps(current.id)[index];
      if (!step) close(current.shown);
      else {
        const ready = stepReady(step);
        setRun({ ...current, index, ready, shown: current.shown || ready });
      }
    },
    [close, setRun],
  );

  const request = useCallback(
    (id: TourId) => {
      if (!startable(id)) return;
      const current = runRef.current;
      if (current?.id === id || queue.current.includes(id)) return;
      if (current) queue.current.push(id);
      else setRun({ id, index: 0, ready: false, shown: false });
    },
    [setRun],
  );

  const release = useCallback(
    (id: TourId) => {
      queue.current = queue.current.filter((queued) => queued !== id);
      const current = runRef.current;
      if (current?.id === id) close(current.shown);
    },
    [close],
  );

  const next = useCallback(() => {
    const current = runRef.current;
    if (current) goTo(current.index + 1);
  }, [goTo]);

  // Back to the nearest earlier step still on the page; none, and ‹ does nothing.
  const previous = useCallback(() => {
    const current = runRef.current;
    if (!current) return;
    const steps = tourSteps(current.id);
    for (let index = current.index - 1; index >= 0; index--) {
      const step = steps[index]!;
      if (liveTarget(step)) {
        const ready = stepReady(step);
        setRun({ ...current, index, ready, shown: current.shown || ready });
        return;
      }
    }
  }, [setRun]);

  const end = useCallback(() => close(true), [close]);

  // Wait for the step's element. Keyed on the step's id and index, never on an object rebuilt each render.
  const runId = run?.id;
  const runIndex = run?.index;
  const waiting = run !== null && !run.ready;
  useEffect(() => {
    if (!waiting || runId === undefined || runIndex === undefined) return;
    const step = tourSteps(runId)[runIndex];
    if (!step) return;
    const check = () => {
      const current = runRef.current;
      if (!current || current.id !== runId || current.index !== runIndex || current.ready) return;
      if (stepReady(step)) setRun({ ...current, ready: true, shown: true });
    };
    // A frame first, so the page that asked has painted.
    const frame = requestAnimationFrame(check);
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "data-tour"],
    });
    // Skipped only when the element never came; one under a dialog waits for the dialog to close.
    const timer = setTimeout(() => {
      if (!liveTarget(step)) goTo(runIndex + 1);
    }, TOUR_TARGET_WAIT_MS);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [waiting, runId, runIndex, goTo, setRun]);

  useEffect(() => {
    notifyHandler = (target, action) => {
      const current = runRef.current;
      if (!current?.ready) return;
      const step = tourSteps(current.id)[current.index];
      if (step?.prompt === action && stepTargets(step).some((candidate) => candidate.target === target)) goTo(current.index + 1);
    };
    return () => {
      notifyHandler = null;
    };
  }, [goTo]);

  const ready = run?.ready ?? false;
  const api = useMemo<TourApi>(
    () => ({
      active: ready && runId !== undefined && runIndex !== undefined ? { id: runId, index: runIndex } : null,
      request,
      release,
      next,
      previous,
      end,
    }),
    [ready, runId, runIndex, request, release, next, previous, end],
  );

  const activeSteps = ready && runId !== undefined ? tourSteps(runId) : [];
  const activeStep = runIndex === undefined ? undefined : activeSteps[runIndex];
  return (
    <TourContext value={api}>
      {children}
      {activeStep && runId !== undefined && runIndex !== undefined && (
        <TourOverlay
          key={runId}
          step={activeStep}
          title={tourTitle(runId)}
          index={runIndex}
          count={activeSteps.length}
          onNext={next}
          onPrevious={previous}
          onEnd={end}
        />
      )}
    </TourContext>
  );
}

export function useTour(): TourApi {
  const api = useContext(TourContext);
  if (!api) throw new Error("useTour needs the TourProvider (root layout)");
  return api;
}
