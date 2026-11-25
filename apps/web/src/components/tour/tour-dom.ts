import { stepTargets, type TourStep, type TourTarget } from "@/lib/tours";

/**
 * What the tours read off the page: a step's element by its `data-tour` id, and whether a layer the player opened
 * covers it. Shared by the provider (when a step can show) and the overlay (when to stand aside).
 */

/**
 * Layers drawn over the page: open dialogs and sheets, the enlarged card, and the popped-out lists of menus and selects.
 * A hover tip (`data-tip`) is not one: a mouse resting on a lit element opens it, and the tour would hide until it left.
 */
const LAYERS =
  '[role="dialog"][data-state="open"]:not([data-tip]), [data-card-zoom], [data-radix-popper-content-wrapper]:not(:has([data-tip]))';

/**
 * A target's element: the first one laid out. A page can stamp one id twice when only one copy shows at a time (Deck
 * stats' docked bar on phones, its rail on desktop; the other is display: none).
 */
export const targetElement = (target: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`)].find((element) => element.getClientRects().length > 0) ??
  null;

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
