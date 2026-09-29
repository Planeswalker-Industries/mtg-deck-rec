/**
 * The land art behind the landing page's sections, with the credit each one owes. Local high-res files, so the page
 * needs no catalog read to render. Swapping a vista is a change to one entry here.
 */
export interface Vista {
  src: string;
  /** The card the art comes from, and its page for the credit link. */
  cardName: string;
  cardSlug: string;
  artist: string;
  /** A Tailwind `object-*` class: which part of the art stays in frame when it is cropped to the section. */
  position: string;
}

const CAVERN_OF_SOULS: Vista = {
  src: "/cavern_of_souls_high_res.jpg",
  cardName: "Cavern of Souls",
  cardSlug: "cavern-of-souls",
  artist: "Alayna Danner",
  position: "object-center",
};

/**
 * Alayna Danner's Plains: one tower in three portrait panels (spire, middle, base). The hero is wide, so it shows the
 * base with its ground line, framed low; the closing panel is tall enough for the spire in the dusk sky.
 */
const PLAINS_SPIRE: Vista = {
  src: "/plains_hi_res.jpg",
  cardName: "Plains",
  cardSlug: "plains",
  artist: "Alayna Danner",
  position: "object-[center_40%]",
};

const PLAINS_MIDDLE: Vista = {
  src: "/plains2_hi_res.jpg",
  cardName: "Plains",
  cardSlug: "plains",
  artist: "Alayna Danner",
  position: "object-center",
};

const PLAINS_BASE: Vista = {
  src: "/plains3_hi_res.jpg",
  cardName: "Plains",
  cardSlug: "plains",
  artist: "Alayna Danner",
  position: "object-[center_62%]",
};

/** Every vista on hand, so a swap below is one word. */
export const VISTAS = { CAVERN_OF_SOULS, PLAINS_SPIRE, PLAINS_MIDDLE, PLAINS_BASE } as const;

/** Behind the hero, full width. */
export const HERO_VISTA: Vista = PLAINS_BASE;

/** Behind the closing panel beside Popular Decks. */
export const CLOSING_VISTA: Vista = PLAINS_SPIRE;
