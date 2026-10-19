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
 * `/deck?start=build` opens the deck tool on a commander picker instead of the decklist box; the picked commander gets
 * a built deck (`BuildView`). The links that start a deck from nothing ("Build a deck") use it.
 */
export const DECK_START_PARAM = "start";
export const DECK_START_BUILD = "build";
export const BUILD_DECK_HREF = `/deck?${DECK_START_PARAM}=${DECK_START_BUILD}`;

/** The bracket a build starts at until the player picks another: 3, Upgraded, where most decks at a casual table sit. */
export const BUILD_DEFAULT_BRACKET = 3;

/**
 * A touch target of at least 44 px on phones, drawn by an invisible pseudo-element centred on the control, so compact
 * controls keep their look and layout. `relative` anchors it; a caller's own position class still wins. Use the
 * `::before` form where the control's `::after` is taken (the line tabs draw their underline with it).
 */
export const PHONE_HIT_AREA =
  "relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 max-sm:after:size-full max-sm:after:min-h-11 max-sm:after:min-w-11 max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2 max-sm:after:content-['']";
export const PHONE_HIT_AREA_BEFORE =
  "relative max-sm:before:absolute max-sm:before:top-1/2 max-sm:before:left-1/2 max-sm:before:size-full max-sm:before:min-h-11 max-sm:before:min-w-11 max-sm:before:-translate-x-1/2 max-sm:before:-translate-y-1/2 max-sm:before:content-['']";

/**
 * Every text link on the site: primary blue and underlined, so blue always means "this goes somewhere". The underline
 * firms up on hover; keyboard focus gets the site's outline. Callers add size and weight, never another colour.
 */
export const TEXT_LINK =
  "text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * A toggle pill or segment (a filter, a grouping, a tab): blue text while off, because it can be pressed, and the solid
 * primary when on. Callers add shape and size.
 */
export const TOGGLE_OFF = "text-primary hover:bg-primary/10";
export const TOGGLE_ON = "bg-primary text-primary-foreground";
/** A toggle pill's outline: blue while off, filled when on. */
export const PILL_OFF = `border-primary/45 ${TOGGLE_OFF}`;
export const PILL_ON = `border-primary ${TOGGLE_ON}`;
