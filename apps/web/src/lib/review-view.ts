/** How the player reviews recommendations: swiping one card at a time, or the list with tabs. */
export type ReviewView = "swipe" | "list";

const STORAGE_KEY = "mtg-deck-rec:review-view";

/** The view the player last chose in this browser; swiping on a first visit. */
export function readReviewView(): ReviewView {
  try {
    return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "swipe";
  } catch {
    return "swipe";
  }
}

export function writeReviewView(view: ReviewView): void {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Storage is blocked; the choice just won't be remembered.
  }
}
