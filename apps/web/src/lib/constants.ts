/**
 * Values the web app shares across files. A value used in one file stays at the top of that file; scoring weights
 * and anti-abuse thresholds belong in `app_config`, not here (the repo is public).
 */

/**
 * Most rows one collection import may carry. Mirrors `app_config.collections.maxImportRows`, which the database
 * enforces on account imports; the browser checks it first so a too-large export fails before any matching.
 */
export const COLLECTION_MAX_IMPORT_ROWS = 50_000;

/** Longest text the collection paste box takes: about 25,000 lines. Anything larger is a file, not a paste. */
export const MAX_COLLECTION_PASTE_CHARS = 1_000_000;

/** Largest deck file the deck tool reads. A deck export is a few KB; a bigger file is not a decklist. */
export const MAX_DECK_FILE_BYTES = 1024 * 1024;

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

/**
 * The bracket the start form (T091) and a build aim for until the player picks another: 3, Upgraded, where most decks at
 * a casual table sit.
 */
export const DEFAULT_START_BRACKET = 3;
export const BUILD_DEFAULT_BRACKET = DEFAULT_START_BRACKET;

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
 * Every text link on the site: the primary (espresso on paper, brass on the wood) and underlined, so that colour always
 * means "this goes somewhere". The underline firms up on hover; keyboard focus gets the site's outline. Callers add
 * size and weight, never another colour.
 */
export const TEXT_LINK =
  "text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Disclosure beside TCGplayer links, shown only when the deploy has a tracking link (`affiliateOn()`). */
export const AFFILIATE_DISCLOSURE = "TCGplayer links help pay for the servers.";
/** How long a shopping list removal can be undone: the floor a phone user can still catch (owner may tune). */
export const SHOPPING_UNDO_MS = 5000;
/** How long an armed remove button (first tap on a phone) waits for the confirming tap before it disarms. */
export const REMOVE_ARM_MS = 3000;

/** A pointer resting on a tip's trigger this long opens it; passing over a row of them opens none. */
export const TIP_HOVER_DELAY_MS = 200;

/**
 * A word that opens its own explanation (a switch's "Public"): the text stays ink, an espresso dotted underline says it
 * can be pressed and that it explains rather than goes somewhere. Tapped or clicked, never hover-only: phones have no
 * hover.
 */
export const HINT_TEXT =
  "underline decoration-primary decoration-dotted decoration-2 underline-offset-4 transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * A plain page's sheet of paper (decks list, account, feedback, privacy, not-found, errors): edge to edge on phones, so
 * the copy keeps the screen's width, with the gutter back as padding.
 */
export const PAGE_SHEET = "sheet flex flex-col gap-4 p-4 max-sm:-mx-4 sm:p-6";

/** The shape both seals share: the heading face, a 44 px target. */
const SEAL_SHAPE =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 font-heading text-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The wax seal (the `seal` utility): a page's one main action, as on the homepage. Solid espresso with a brass rim.
 * Callers add width and an icon if they want one.
 */
export const SEAL_BUTTON = `seal ${SEAL_SHAPE}`;

/** The seal's quiet partner (`seal-outline`): espresso on raised paper, edged in brass, beside a seal. */
export const SEAL_OUTLINE_BUTTON = `seal-outline ${SEAL_SHAPE}`;

/**
 * A link that credits an artist: muted, not espresso, so it never competes with the page's priority actions. Still
 * underlined, so it reads as a link.
 */
export const CREDIT_LINK =
  "text-muted-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * A toggle pill or segment (a filter, a grouping, a tab): espresso text while off, because it can be pressed. On, it
 * keeps the same look with a thick espresso edge; the solid primary fill is kept for primary action buttons. The edge
 * is an inset ring, so it costs no layout and works on segments that have no border of their own. Callers add shape
 * and size.
 */
export const TOGGLE_OFF = "text-primary hover:bg-primary/10";
export const TOGGLE_ON = `${TOGGLE_OFF} ring-3 ring-inset ring-primary`;
/** A toggle pill's outline: a thin espresso border while off; on, the full border plus the ring makes the thick edge. */
export const PILL_OFF = `border-primary/45 ${TOGGLE_OFF}`;
export const PILL_ON = `border-primary ${TOGGLE_OFF} ring-2 ring-inset ring-primary`;
