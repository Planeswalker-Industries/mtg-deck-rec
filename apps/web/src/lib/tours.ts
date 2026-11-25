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

/**
 * The build start (Choose commander), approved by the owner 2026-11-24. Like every tour, top to bottom: the highest
 * element that needs explaining first.
 */
const BUILD_START: readonly TourStep[] = [
  { target: "build-start.heading", prompt: "read", text: "So you want to build a Commander deck, huh?" },
  { target: "build-start.heading", prompt: "read", text: "Well, you've come to the right place." },
  {
    target: "build-start.source",
    prompt: "read",
    text: "First, choose: build from the cards you already own, or from any card ever printed.",
    otherwise: [
      {
        target: "build-start.import",
        text: "Want to build from cards you own? Import your collection first. Otherwise we use any card ever printed.",
      },
    ],
  },
  {
    target: "build-start.commander",
    prompt: "read",
    text: "Then type part of your commander's name and pick it.",
    otherwise: [{ target: "build-start.picked", text: "Here's your commander. Tap Change to pick another." }],
  },
  {
    target: "build-start.bracket",
    prompt: "read",
    text: "Set how strong the deck should be. If you don't know what brackets are, pick 3!",
  },
  {
    target: "build-start.budget",
    prompt: "read",
    text: "Don't want a $10,000 deck? No problem. Set a Max per card and a Max to spend. No card costs more than the first, and what you pay, collection or not, never tops the second.",
  },
  { target: "build-start.build", prompt: "tap", text: "Once you're ready, tap this and we're off to the races!" },
];

/** The paste screen (Upgrade a deck), approved by the owner 2026-11-24. */
const DECK_START: readonly TourStep[] = [
  { target: "deck-start.heading", prompt: "read", text: "Got a deck already? Let's make it better." },
  {
    target: "deck-start.owned",
    prompt: "tap",
    text: "Upload your collection and improve your deck with the cards you already own!",
  },
  { target: "deck-start.online", prompt: "tap", text: "Or we can use the absolute best cards out there. Your choice!" },
  {
    target: "deck-start.paste",
    prompt: "read",
    text: "Paste your decklist here. A list from any site works: ManaBox, Archidekt, Moxfield, Notepad. Whatever!",
  },
  {
    target: "deck-start.bracket",
    prompt: "tap",
    text: "Set how strong you want your deck to be. If you don't know what brackets are, pick 3!",
  },
  {
    target: "deck-start.budget",
    prompt: "read",
    text: "Set a Max per card and a Max to spend. We never suggest a card above the first, and the cards we add never top the second.",
  },
  { target: "deck-start.budget", prompt: "read", text: "Set them both to ZERO and we'll only use cards you own." },
  { target: "deck-start.budget", prompt: "read", text: "Leave them blank and the sky's the limit brother!" },
  {
    target: "deck-start.file",
    prompt: "read",
    text: "Apps like ManaBox let you export a deck as a CSV file. Drop it here and we'll load it in automatically!",
  },
  {
    target: "deck-start.go",
    prompt: "tap",
    text: "Once your list is in, tap Analyze deck. No list handy? Try the app out by trying our sample deck.",
  },
];

export const TOURS: Record<TourId, readonly TourStep[]> = {
  "build-start": BUILD_START,
  "deck-start": DECK_START,
};

/** A tour's steps; none for an id without a tour. */
export const tourSteps = (id: TourId): readonly TourStep[] => TOURS[id] ?? [];

/** Every element a step can light, its own first. */
export const stepTargets = (step: TourStep): readonly TourTarget[] => [step, ...(step.otherwise ?? [])];
