/**
 * Values the web app shares across files. A value used in one file stays at the top of that file; scoring weights
 * and anti-abuse thresholds belong in `app_config`, not here (the repo is public).
 */

/**
 * Most rows one collection import may carry. Mirrors `app_config.collections.maxImportRows`, which the database
 * enforces on account imports; the browser checks it first so a too-large export fails before any matching.
 */
export const COLLECTION_MAX_IMPORT_ROWS = 50_000;

/**
 * The CSS custom property the deck tool's sticky deck bar sets to its own height, so other sticky surfaces (the
 * deckbuilder's search filters) stop below it rather than under it. Tailwind classes spell it out literally,
 * `top-[var(--deck-bar-height,0px)]`, because class names cannot be built at runtime; keep the two in step.
 */
export const DECK_BAR_HEIGHT_VAR = "--deck-bar-height";

/**
 * A touch target of at least 44 px on phones, drawn by an invisible pseudo-element centred on the control, so compact
 * controls keep their look and layout. `relative` anchors it; a caller's own position class still wins. Use the
 * `::before` form where the control's `::after` is taken (the line tabs draw their underline with it).
 */
export const PHONE_HIT_AREA =
  "relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 max-sm:after:size-full max-sm:after:min-h-11 max-sm:after:min-w-11 max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2 max-sm:after:content-['']";
export const PHONE_HIT_AREA_BEFORE =
  "relative max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-full max-sm:before:min-h-11 max-sm:before:min-w-11 max-sm:before:-translate-x-1/2 max-sm:before:-translate-y-1/2 max-sm:before:content-['']";
