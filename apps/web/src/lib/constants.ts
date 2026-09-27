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
