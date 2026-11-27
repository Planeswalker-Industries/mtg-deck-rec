import type { Route } from "next";
import type { CardSummary } from "@mtg/core/contract";
import { buildCommanderHref, HOME_SHOWCASE_DAYS, HOME_SHOWCASE_SIZE } from "../constants";
import { FEATURED_DECKS, type ColorKey, type FeaturedDeck } from "../featured-decks";
import { CARD_COLUMNS, toCardSummary, type CardRow } from "./cards";
import { logError } from "./error-log";
import type { PublicClient } from "./supabase";

/** Colour identity letters in the order every identity is written. */
const IDENTITY_ORDER: readonly ColorKey[] = ["W", "U", "B", "R", "G"];
/** How two commanders' names read as one plate's title. */
const PAIR_SEPARATOR = " & ";

/** One Popular Commanders plate. */
export interface ShowcaseCommander {
  /** The commander key's slug (pairs included), which the build page takes. */
  slug: string;
  /** The plate's title: the card's name, or both names for a pair. */
  name: string;
  /** The lead commander's card; null only for a fixture entry the catalog didn't supply. */
  card: CardSummary | null;
  /** The second commander of a pair, otherwise null. */
  partner: CardSummary | null;
  /** WUBRG letters of the whole key. */
  colorIdentity: string;
  /** Distinct visitors over the window; 0 for a corpus fill, null for a fixture entry. */
  visitors: number | null;
  /** Corpus decks with this key, or null for a fixture entry. */
  deckCount: number | null;
  /** The build page with this commander picked. */
  href: Route;
}

/** One Latest Decks plate. No deck name and no owner: the homepage shows neither. */
export interface ShowcaseDeck {
  code: string;
  /** The commander key's slug, or null for a commander the corpus has no key for yet. */
  slug: string | null;
  name: string;
  card: CardSummary;
  partner: CardSummary | null;
  colorIdentity: string;
  /** When the deck was saved (ISO). */
  createdAt: string;
  /** The deck's public page. */
  href: Route;
}

export interface HomeShowcase {
  popular: ShowcaseCommander[];
  latest: ShowcaseDeck[];
}

/** `home_showcase()`'s Popular items, as the function writes them. */
interface PopularRow {
  slug: string;
  commander1: number;
  commander2: number | null;
  visitors: number;
  deckCount: number;
}

/** `home_showcase()`'s Latest items. */
interface LatestRow {
  code: string;
  slug: string | null;
  commander1: number;
  commander2: number | null;
  createdAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isOptionalId = (value: unknown): value is number | null => value === null || value === undefined || isId(value);

function popularRows(value: unknown): PopularRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): PopularRow[] => {
    if (!isRecord(item) || typeof item.slug !== "string" || !isId(item.commander1) || !isOptionalId(item.commander2)) return [];
    const visitors = typeof item.visitors === "number" ? item.visitors : 0;
    const deckCount = typeof item.deckCount === "number" ? item.deckCount : 0;
    return [{ slug: item.slug, commander1: item.commander1, commander2: item.commander2 ?? null, visitors, deckCount }];
  });
}

function latestRows(value: unknown): LatestRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LatestRow[] => {
    if (!isRecord(item) || typeof item.code !== "string" || typeof item.createdAt !== "string") return [];
    if (!isId(item.commander1) || !isOptionalId(item.commander2)) return [];
    const slug = typeof item.slug === "string" ? item.slug : null;
    return [{ code: item.code, slug, commander1: item.commander1, commander2: item.commander2 ?? null, createdAt: item.createdAt }];
  });
}

/** Every letter in either identity, in WUBRG order. */
function unionIdentity(...identities: string[]): string {
  return IDENTITY_ORDER.filter((key) => identities.some((identity) => identity.includes(key))).join("");
}

/** The fixture's identity: the colours its cards count under. */
const fixtureIdentity = (deck: FeaturedDeck) => IDENTITY_ORDER.filter((key) => deck.colorCounts[key] > 0).join("");

function fixtureCommander(deck: FeaturedDeck): ShowcaseCommander {
  return {
    slug: deck.slug,
    name: deck.commanderName,
    card: null,
    partner: null,
    colorIdentity: fixtureIdentity(deck),
    visitors: null,
    deckCount: null,
    href: buildCommanderHref(deck.slug),
  };
}

/** The fallback: the checked-in featured commanders, no counts, no Latest. */
const fixtureShowcase = (): HomeShowcase => ({ popular: FEATURED_DECKS.slice(0, HOME_SHOWCASE_SIZE).map(fixtureCommander), latest: [] });

/**
 * The fallback with the fixture commanders' cards, when the database answers but `home_showcase()` didn't (a preview
 * against an older schema): their art and identity by slug, best effort, still no counts.
 */
async function fixtureShowcaseWithCards(db: PublicClient): Promise<HomeShowcase> {
  const fallback = fixtureShowcase();
  try {
    const slugs = fallback.popular.map((entry) => entry.slug);
    const { data, error } = await db.from("cards").select(CARD_COLUMNS).in("slug", slugs).is("deleted_at", null);
    if (error) return fallback;
    const bySlug = new Map(((data ?? []) as CardRow[]).map((row) => [row.slug, toCardSummary(row)]));
    const popular = fallback.popular.map((entry) => {
      const card = bySlug.get(entry.slug);
      return card ? { ...entry, card, name: card.name, colorIdentity: card.colorIdentity } : entry;
    });
    return { ...fallback, popular };
  } catch {
    return fallback;
  }
}

/** Fills Popular up to the column size from the fixture, skipping slugs already shown. */
function toppedUp(popular: ShowcaseCommander[]): ShowcaseCommander[] {
  const shown = new Set(popular.map((entry) => entry.slug));
  const fill = FEATURED_DECKS.filter((deck) => !shown.has(deck.slug)).map(fixtureCommander);
  return [...popular, ...fill].slice(0, HOME_SHOWCASE_SIZE);
}

/** The commander cards of one entry, or null when either left the catalog. */
function entryCards(cards: Map<number, CardSummary>, commander1: number, commander2: number | null) {
  const card = cards.get(commander1);
  const partner = commander2 === null ? null : cards.get(commander2);
  if (!card || partner === undefined) return null;
  return {
    card,
    partner,
    name: partner ? `${card.name}${PAIR_SEPARATOR}${partner.name}` : card.name,
    colorIdentity: unionIdentity(card.colorIdentity, partner?.colorIdentity ?? ""),
  };
}

/**
 * The homepage's Commanders & Decks: Popular Commanders (most visitors over the window, filled from the corpus) and
 * Latest Decks (newest complete public decks, one per commander). One `home_showcase()` call ranks both lists, then one
 * `cards` read brings every commander's art and identity.
 *
 * Never throws: the homepage renders with the database down and CI has no catalog. A null client (no configuration)
 * or a failed read returns the fixture commanders (with their cards when the catalog still answers) and an empty
 * Latest; a failed read is logged as a warning. An entry
 * whose card the catalog didn't return is dropped, and Popular tops up from the fixture so it still shows three.
 */
export async function loadHomeShowcase(db: PublicClient | null): Promise<HomeShowcase> {
  if (!db) return fixtureShowcase();

  try {
    const { data, error } = await db.rpc("home_showcase", { p_days: HOME_SHOWCASE_DAYS });
    if (error) {
      logError({ area: "home.showcase", error, code: error.code, level: "warning", context: { step: "rpc" } });
      return fixtureShowcaseWithCards(db);
    }
    const value = isRecord(data) ? data : {};
    const popular = popularRows(value.popular);
    const latest = latestRows(value.latest);

    const ids = [
      ...new Set([...popular, ...latest].flatMap((row) => (row.commander2 === null ? [row.commander1] : [row.commander1, row.commander2]))),
    ];
    const cards = new Map<number, CardSummary>();
    if (ids.length > 0) {
      const { data: rows, error: cardsError } = await db.from("cards").select(CARD_COLUMNS).in("id", ids).is("deleted_at", null);
      if (cardsError) {
        logError({
          area: "home.showcase",
          error: cardsError,
          code: cardsError.code,
          level: "warning",
          context: { step: "cards", ids: ids.length },
        });
        return fixtureShowcase();
      }
      for (const row of (rows ?? []) as CardRow[]) cards.set(row.id, toCardSummary(row));
    }

    const popularEntries = popular.flatMap((row): ShowcaseCommander[] => {
      const found = entryCards(cards, row.commander1, row.commander2);
      if (!found) return [];
      return [{ ...found, slug: row.slug, visitors: row.visitors, deckCount: row.deckCount, href: buildCommanderHref(row.slug) }];
    });
    const latestEntries = latest.flatMap((row): ShowcaseDeck[] => {
      const found = entryCards(cards, row.commander1, row.commander2);
      if (!found) return [];
      const href = `/decks/${encodeURIComponent(found.card.slug)}/${encodeURIComponent(row.code)}` as Route;
      return [{ ...found, code: row.code, slug: row.slug, createdAt: row.createdAt, href }];
    });

    return { popular: toppedUp(popularEntries), latest: latestEntries.slice(0, HOME_SHOWCASE_SIZE) };
  } catch (error) {
    logError({ area: "home.showcase", error, level: "warning", context: { step: "load" } });
    return fixtureShowcase();
  }
}
