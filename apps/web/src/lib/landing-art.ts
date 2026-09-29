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
}

const CAVERN_OF_SOULS: Vista = {
  src: "/cavern_of_souls_high_res.jpg",
  cardName: "Cavern of Souls",
  cardSlug: "cavern-of-souls",
  artist: "Alayna Danner",
};

/** Behind the hero, full width. */
export const HERO_VISTA: Vista = CAVERN_OF_SOULS;

/** Behind the closing panel beside Popular Decks. */
export const CLOSING_VISTA: Vista = CAVERN_OF_SOULS;
