import { stepTargets, type TourStep, type TourTarget } from "@/lib/tours";

/**
 * What the tours read off the page: a step's element by its `data-tour` id, and whether a layer the player opened
 * covers it. Shared by the provider (when a step can show) and the overlay (when to stand aside).
 */

/** Layers drawn over the page: open dialogs and sheets, and the popped-out lists of menus and selects. */
const LAYERS = '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]';

export const targetElement = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);

/** The element a step lights now, and its text: its own target, else the first stand-in on the page. */
export interface LiveTarget extends TourTarget {
  element: HTMLElement;
}

export function liveTarget(step: TourStep): LiveTarget | null {
  for (const candidate of stepTargets(step)) {
    const element = targetElement(candidate.target);
    if (element) return { ...candidate, element };
  }
  return null;
}

/** Whether an open layer that doesn't hold the element sits over the page (a dialog lets its own contents through). */
export const covered = (element: Element) => [...document.querySelectorAll(LAYERS)].some((layer) => !layer.contains(element));

/** A step can show once its element is on the page and nothing the player opened covers it. */
export function stepReady(step: TourStep): boolean {
  const live = liveTarget(step);
  return live !== null && !covered(live.element);
}
