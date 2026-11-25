/**
 * The first-time tours: one list of steps per page (or per screen inside one). A step names its element only by the
 * `data-tour` id on that element and holds what the bubble says; the overlay measures the element live, so a tour
 * follows the page as it changes. Pages start their tour with `<PageTour id>`.
 */

/** What a step asks for: a tap on the lit element, a swipe across it, or just a read (the bubble's › moves on). */
export type TourPrompt = "tap" | "swipe" | "read";

/** An element a step can light, by its `data-tour` id, and what the bubble says beside it. */
export interface TourTarget {
  target: string;
  text: string;
  /** A stand-in that asks for something else than its step (a read where the step's own element takes a swipe). */
  prompt?: TourPrompt;
}

export interface TourStep extends TourTarget {
  prompt: TourPrompt;
  /** Which way a swipe step's arrow points. */
  swipe?: "horizontal" | "up";
  /**
   * Stand-ins for a screen that shows something else in the target's place (a link where a toggle needs a
   * collection): the first one on the page lights instead, with its own text.
   */
  otherwise?: readonly TourTarget[];
}

/** A tour's id, also its key in the seen list. Narrowed to a union as tours are added. */
export type TourId = string;

// Every tour's text puts its key words in capitals, as a game would (owner, 2026-11-24): the things the player
// handles (DECK, COMMANDER, BRACKET, COLLECTION), what they do (TAP, SWIPE, EDIT, SAVE, NEXT, BACK) and the names of
// steps, buttons and pips (ADD, CUT, FIX, SWAP, FINISH, ALL, SKIP, DECK SHORTAGE PIPS).

/**
 * The build start (Choose commander), approved by the owner 2026-11-24. Like every tour, top to bottom: the highest
 * element that needs explaining first.
 */
const BUILD_START: readonly TourStep[] = [
  { target: "build-start.heading", prompt: "read", text: "So you want to BUILD a COMMANDER DECK, huh?" },
  { target: "build-start.heading", prompt: "read", text: "Well, you've come to the right place." },
  {
    target: "build-start.source",
    prompt: "read",
    text: "First, choose: BUILD from the cards you already own, or from any card ever printed.",
    otherwise: [
      {
        target: "build-start.import",
        text: "Want to BUILD from cards you own? IMPORT your COLLECTION first. Otherwise we use any card ever printed.",
      },
    ],
  },
  {
    target: "build-start.commander",
    prompt: "read",
    text: "Then type part of your COMMANDER's name and pick it.",
    otherwise: [{ target: "build-start.picked", text: "Here's your COMMANDER. TAP CHANGE to pick another." }],
  },
  {
    target: "build-start.bracket",
    prompt: "read",
    text: "Set how strong the DECK should be. If you don't know what BRACKETS are, pick 3!",
  },
  {
    target: "build-start.budget",
    prompt: "read",
    text: "Don't want a $10,000 DECK? No problem. Set a MAX PER CARD and a MAX TO SPEND. No card costs more than the first, and what you pay, COLLECTION or not, never tops the second.",
  },
  { target: "build-start.build", prompt: "tap", text: "Once you're ready, TAP this and we're off to the races!" },
];

/** The paste screen (Upgrade a deck), approved by the owner 2026-11-24. */
const DECK_START: readonly TourStep[] = [
  { target: "deck-start.heading", prompt: "read", text: "Got a DECK already? Let's make it better." },
  {
    target: "deck-start.owned",
    prompt: "tap",
    text: "UPLOAD your COLLECTION and improve your DECK with the cards you already own!",
  },
  { target: "deck-start.online", prompt: "tap", text: "Or we can use the absolute best cards out there. Your choice!" },
  {
    target: "deck-start.paste",
    prompt: "read",
    text: "PASTE your decklist here. A list from any site works: ManaBox, Archidekt, Moxfield, Notepad. Whatever!",
  },
  {
    target: "deck-start.bracket",
    prompt: "tap",
    text: "Set how strong you want your DECK to be. If you don't know what BRACKETS are, pick 3!",
  },
  {
    target: "deck-start.budget",
    prompt: "read",
    text: "Set a MAX PER CARD and a MAX TO SPEND. We never suggest a card above the first, and the cards we ADD never top the second.",
  },
  { target: "deck-start.budget", prompt: "read", text: "Set them both to ZERO and we'll only use cards you own." },
  { target: "deck-start.budget", prompt: "read", text: "Leave them blank and the sky's the limit brother!" },
  {
    target: "deck-start.file",
    prompt: "read",
    text: "Apps like ManaBox let you export a DECK as a CSV file. DROP it here and we'll load it in automatically!",
  },
  {
    target: "deck-start.go",
    prompt: "tap",
    text: "Once your list is in, TAP ANALYZE DECK. No list handy? Try the app out with our SAMPLE DECK.",
  },
];

/** The built deck, before TUNE IT opens it in the journey, approved by the owner 2026-11-24. */
const BUILD_RESULT: readonly TourStep[] = [
  {
    target: "build-result.tune",
    prompt: "read",
    text: "When you're ready, TAP here and we'll fine tune this DECK into a masterpiece!",
  },
];

/** The journey tour's line on the steps, before it names the one to tap. */
const JOURNEY_STEPS = "Your DECK Journey runs left to right, one step at a time.";

/**
 * The journey page's opening, approved by the owner 2026-11-24: the deck bar, then the step the round starts on, lit
 * alone in the stepper (the current tab carries `journey.step.<phase>`). Tapping it hands over to that step's tour.
 */
const JOURNEY: readonly TourStep[] = [
  {
    target: "journey.bar",
    prompt: "read",
    text: "Welcome to the DECK Journey! Up here you can rename your DECK, EDIT your decklist and adjust your BRACKET!",
  },
  {
    target: "journey.step.add",
    prompt: "tap",
    text: `${JOURNEY_STEPS} TAP ADD to start!`,
    otherwise: [
      { target: "journey.step.cut", text: `${JOURNEY_STEPS} TAP CUT to start!` },
      { target: "journey.step.fix", text: `${JOURNEY_STEPS} TAP FIX to start!` },
    ],
  },
];

/** Add's swipe view, approved by the owner 2026-11-24. Its first card has STAT CHANGE PIPS (`AddPhase`). */
const ADD: readonly TourStep[] = [
  {
    target: "add.roles",
    prompt: "read",
    text: "NICE! These are your DECK SHORTAGE PIPS. They show where your DECK falls short.",
  },
  {
    target: "add.roles",
    prompt: "tap",
    text: "Ramp 5/10 means it runs 5 of the 10 it should. TAP one to see only those cards.",
  },
  { target: "add.all", prompt: "tap", text: "TAP ALL to see every card again." },
  {
    target: "add.card",
    prompt: "swipe",
    swipe: "horizontal",
    text: "Here's a card DECKS like yours run. SWIPE to see more and pick your favorites!",
  },
  {
    target: "add.chips",
    prompt: "read",
    text: "These are your STAT CHANGE PIPS. They show how ADDING this card changes your DECK.",
  },
  { target: "add.chips", prompt: "read", text: "Green is GOOD! Red, not so much." },
  { target: "add.decide", prompt: "tap", text: "TAP ADD to put it in your DECK, or SKIP to pass on it!" },
];

/**
 * The Save Deck page (the round's Save: the deck name form up in the bar, the decklist below), approved by the owner
 * 2026-11-24. Top to bottom, then the page's own finish: name it and SAVE. Names only what earlier screens didn't show.
 */
const SAVE_DECK: readonly TourStep[] = [
  { target: "save-deck.bar", prompt: "read", text: "This is your COMMANDER PANEL. RENAME and SAVE your DECK up here." },
  { target: "save-deck.list", prompt: "read", text: "Here's your DECKLIST, sorted into categories." },
  { target: "save-deck.card", prompt: "tap", text: "TAP a CARD PLATE to see the full card!" },
  {
    target: "save-deck.name",
    prompt: "read",
    text: "Great job on this DECK. Let's give it a name.",
  },
  { target: "save-deck.save", prompt: "tap", text: "TAP SAVE and your DECK is yours to come BACK to anytime!" },
];

/** The close-every-ring line both screens end Deck stats on. */
const ALL_RINGS = "remember - if you close ALL RINGS - you've got a NICE DECK!";

/**
 * Deck stats, approved by the owner 2026-11-24: on phones the docked bar (its score, then its money, then Swipe up to
 * open the sheet), on desktop the same parts of the rail, ending on its rings. It runs on Swap's swipe view, or the
 * first time the player opens the sheet on their own: the sheet stays shut and the tour runs instead.
 */
const DECK_STATS: readonly TourStep[] = [
  {
    target: "deck-stats.bar",
    prompt: "read",
    text: "Well, looks like you stumbled upon something pretty nifty! This here is the DECK STATS Panel! Let me break it down.",
    otherwise: [
      {
        target: "deck-stats.rail",
        text: "Well, looks like you stumbled upon something pretty nifty! This here is the DECK STATS Panel! Let me break it down.",
      },
    ],
  },
  {
    target: "deck-stats.score",
    prompt: "read",
    text: "This is your SCORE. 3/11 means 3 of your 11 stats are right where they should be.",
  },
  {
    target: "deck-stats.score",
    prompt: "read",
    text: "With a card on screen, it shows the SCORE that card would give you. Green arrow up? That card helps!",
  },
  { target: "deck-stats.money", prompt: "read", text: "This is what your picks cost so far, out of your MAX TO SPEND." },
  {
    target: "deck-stats.bar",
    prompt: "swipe",
    swipe: "up",
    text: `SWIPE UP to explore the details, and ${ALL_RINGS}`,
    otherwise: [{ target: "deck-stats.rings", prompt: "read", text: `Explore the details down here, and ${ALL_RINGS}` }],
  },
];

export const TOURS: Record<TourId, readonly TourStep[]> = {
  "build-start": BUILD_START,
  "deck-start": DECK_START,
  "build-result": BUILD_RESULT,
  journey: JOURNEY,
  add: ADD,
  "save-deck": SAVE_DECK,
  "deck-stats": DECK_STATS,
};

/** Each tour's chapter name, quiet in its bubble beside the step count. */
const TOUR_TITLES: Record<TourId, string> = {
  "build-start": "Build a Deck",
  "deck-start": "Upgrade a Deck",
  "build-result": "Your New Deck",
  journey: "Deck Journey",
  add: "Add",
  "save-deck": "Save Deck",
  "deck-stats": "Deck Stats",
};

/** A tour's chapter name; none for an id without one. */
export const tourTitle = (id: TourId): string => TOUR_TITLES[id] ?? "";

/** A tour's steps; none for an id without a tour. */
export const tourSteps = (id: TourId): readonly TourStep[] => TOURS[id] ?? [];

/** Every element a step can light, its own first. */
export const stepTargets = (step: TourStep): readonly TourTarget[] => [step, ...(step.otherwise ?? [])];
