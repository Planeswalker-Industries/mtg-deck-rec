import { MAX_FEEDBACK_PATH_CHARS } from "@mtg/core/schemas";

/** A same-site path with no query, fragment or spaces: what a report may carry as the page it came from. */
const PAGE_PATH = /^\/[^?#\s]*$/;

/** The page a report is about, from the `from` query value; anything else becomes the home page. Safe in client code. */
export function feedbackFromPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  return path && PAGE_PATH.test(path) && !path.startsWith("//") && path.length <= MAX_FEEDBACK_PATH_CHARS ? path : "/";
}

/** The feedback page, told which page the report is about. */
export function feedbackHref(fromPath: string): `/feedback?from=${string}` {
  return `/feedback?from=${encodeURIComponent(feedbackFromPath(fromPath))}`;
}

/** Deck pages get a placeholder about the deck: the Report link there sends people to the same form. */
export function isDeckPagePath(path: string): boolean {
  return path.startsWith("/decks/") && path.split("/").length > 3;
}
