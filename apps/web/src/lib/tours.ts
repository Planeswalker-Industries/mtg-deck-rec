/**
 * The first-time tours: one list of steps per page (or per screen inside one). A step names its element only by the
 * `data-tour` id on that element and holds what the bubble says; the overlay measures the element live, so a tour
 * follows the page as it changes. Pages start their tour with `<PageTour id>`.
 */

/** What a step asks for: a tap on the lit element, a swipe across it, or just a read (the bubble's › moves on). */
export type TourPrompt = "tap" | "swipe" | "read";

export interface TourStep {
  /** The `data-tour` id of the element the step lights. */
  target: string;
  prompt: TourPrompt;
  text: string;
  /** Which way a swipe step's arrow points. */
  swipe?: "horizontal" | "up";
}

/** A tour's id, also its key in the seen list. Narrowed to a union as tours are added. */
export type TourId = string;

export const TOURS: Record<TourId, readonly TourStep[]> = {};

/** A tour's steps; none for an id without a tour. */
export const tourSteps = (id: TourId): readonly TourStep[] => TOURS[id] ?? [];
