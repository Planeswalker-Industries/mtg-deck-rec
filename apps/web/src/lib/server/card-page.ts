import type { CardDetail, CardFace, CardSummary, CommanderLegality, RecContext, SwapResult, TagId, TagRef } from "@mtg/core/contract";
import { fetchCardsById, toCardSummary } from "./cards";
import { loadSwapPool, rankSwaps } from "./recs";
import type { PublicClient } from "./supabase";

const ALTERNATIVES = 12;
const ALTERNATIVE_POOL = 120;
const PLAYED_WITH = 12;
const DEFAULT_MIN_DECKS = 50;

/** A card page has no deck: alternatives are for any deck in the card's colors, Game Changers included. */
const NO_DECK: RecContext = {
  deck: { commanders: [], cards: [] },
  bracket: 3,
  bracketSource: "inferred",
  includeGameChangers: true,
  ownership: null,
};

export interface CardPageCommander {
  slug: string;
  commanders: CardSummary[];
  decksWith: number;
  /** The commander's decks that could have run the card (updated since it came out). */
  deckCount: number;
  inclusionRate: number;
}

export interface CardPageData {
  card: CardDetail;
  /** Cards that do the same job in the card's own colors. */
  alternatives: SwapResult;
  /** Commanders whose decks run the card most, as a share of their decks that could have. */
  playedWith: CardPageCommander[];
  /** The card's own commander page, when it leads decks in the corpus. */
  commanderSlug: string | null;
  /** Artist of the printing the images come from, for crediting art shown as a backdrop. */
  artist: string | null;
}

function toFaces(value: unknown): CardFace[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return value.map((face: Record<string, unknown>) => ({
    name: typeof face.name === "string" ? face.name : "",
    manaCost: typeof face.mana_cost === "string" ? face.mana_cost : "",
    typeLine: typeof face.type_line === "string" ? face.type_line : "",
    oracleText: typeof face.oracle_text === "string" ? face.oracle_text : "",
  }));
}

/** Data for a public card page. Null when the slug isn't a card in the catalog. */
export async function loadCardPage(db: PublicClient, slug: string): Promise<CardPageData | null> {
  const { data: found, error } = await db
    .from("cards")
    .select("id, oracle_text, layout, card_faces, scryfall_uri")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Loading card failed: ${error.message}`);
  if (!found) return null;

  const [rows, tagsResult, configResult, keyResult] = await Promise.all([
    fetchCardsById(db, [found.id]),
    db.rpc("card_functional_tags", { p_card_id: found.id }),
    db.rpc("get_public_config", { p_key: "corpus" }),
    db.from("commander_keys").select("id").eq("slug", slug).is("commander_2", null).maybeSingle(),
  ]);
  if (tagsResult.error) throw new Error(`Loading card tags failed: ${tagsResult.error.message}`);
  if (configResult.error) throw new Error(`Loading corpus settings failed: ${configResult.error.message}`);
  if (keyResult.error) throw new Error(`Loading commander key failed: ${keyResult.error.message}`);
  const row = rows.get(found.id);
  if (!row) return null;

  const configured = (configResult.data as { minDecks?: unknown } | null)?.minDecks;
  const minDecks = typeof configured === "number" ? configured : DEFAULT_MIN_DECKS;
  const [pool, topResult, keyStats] = await Promise.all([
    loadSwapPool(db, {
      targetCardId: row.id,
      commanderIds: [],
      includeGameChangers: true,
      excludeIds: [],
      ownedIds: null,
      poolSize: ALTERNATIVE_POOL,
      identityMask: row.color_identity,
    }),
    db.rpc("card_top_commanders", { p_card_id: row.id, p_min_decks: minDecks, p_limit: PLAYED_WITH }),
    keyResult.data
      ? db.from("commander_stats").select("deck_count").eq("commander_key_id", keyResult.data.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (topResult.error) throw new Error(`Loading commanders for card failed: ${topResult.error.message}`);
  if (keyStats.error) throw new Error(`Loading commander stats failed: ${keyStats.error.message}`);

  const topRows = topResult.data ?? [];
  const commanderRows = await fetchCardsById(
    db,
    topRows.flatMap((r) => (r.commander_2 === null ? [r.commander_1] : [r.commander_1, r.commander_2])),
  );
  const playedWith = topRows.flatMap((r): CardPageCommander[] => {
    const ids = r.commander_2 === null ? [r.commander_1] : [r.commander_1, r.commander_2];
    const commanders = ids.flatMap((id) => {
      const commander = commanderRows.get(id);
      return commander ? [toCardSummary(commander)] : [];
    });
    if (commanders.length !== ids.length) return [];
    return [
      {
        slug: r.slug,
        commanders,
        decksWith: r.decks_with,
        deckCount: r.eligible_decks,
        inclusionRate: Math.round((r.decks_with / Math.max(r.eligible_decks, 1)) * 1000) / 1000,
      },
    ];
  });

  const tagRefs = (tagsResult.data ?? []).map((t): TagRef => ({ id: t.tag_id as TagId, slug: t.slug, label: t.label, depth: t.depth }));
  const summary = toCardSummary(row);
  const card: CardDetail = {
    ...summary,
    oracleText: found.oracle_text,
    layout: found.layout,
    faces: toFaces(found.card_faces),
    legalCommander: row.legal_commander as CommanderLegality,
    canBeCommander: row.can_be_commander,
    tags: tagRefs.filter((t) => t.depth === 0),
    tagAncestors: tagRefs.filter((t) => (t.depth ?? 0) > 0),
    scryfallUri: found.scryfall_uri,
  };

  return {
    card,
    alternatives: pool
      ? rankSwaps(pool, { context: NO_DECK, limit: ALTERNATIVES })
      : { mode: "collection_less", target: summary, confidence: "none", suggestions: [], emptyReason: "NO_CANDIDATES" },
    playedWith,
    commanderSlug: (keyStats.data?.deck_count ?? 0) > 0 ? slug : null,
    artist: row.artist,
  };
}
