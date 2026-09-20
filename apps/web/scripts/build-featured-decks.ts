/**
 * Generates the featured-decks.ts fixture from the local catalog and corpus.
 *
 * Reads the top single commanders by deck count, builds each list from commander_card_stats play rates
 * (nonlands by inclusion, then the most-played nonbasic lands, then basics to 100), counts categories
 * with cardCategory, drafts each summary from the commander's functional tags, and writes the fixture
 * file in place.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/build-featured-decks.ts
 *
 * Run by hand; output is reviewed and committed. Never runs in CI or at build time.
 */
import { writeFileSync } from "node:fs";
import { cardCategory } from "@mtg/core/scoring";
import type { CardCategory } from "@mtg/core/contract";
import { createPublicClient } from "../src/lib/server/supabase";

const CATEGORY_ORDER: readonly CardCategory[] = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "planeswalker",
  "battle",
  "land",
];

const TARGET_SIZE = 100;
const TOP_COMMANDERS = 3;
const LAND_TARGET = 36;
const MAX_NONBASIC_LANDS = 24;

/** Basic land per color bit (W=0, U=1, B=2, R=3, G=4). */
const BASIC_LANDS = ["Plains", "Island", "Swamp", "Mountain", "Forest"] as const;

interface CardRow {
  id: number;
  name: string;
  slug: string;
  type_line: string;
  is_basic_land: boolean;
  color_identity: number;
  legal_commander: string;
}

interface FeaturedEntry {
  slug: string;
  commanderName: string;
  summary: string;
  decklist: string;
  composition: Record<CardCategory, number>;
  colorCounts: Record<ColorKey, number>;
  cardCount: number;
}

type ColorKey = "W" | "U" | "B" | "R" | "G" | "C";

const COLOR_KEYS: readonly ColorKey[] = ["W", "U", "B", "R", "G", "C"];
const COLOR_OF_BIT: Record<number, ColorKey> = { 1: "W", 2: "U", 4: "B", 8: "R", 16: "G" };

const emptyComposition = (): Record<CardCategory, number> => ({
  creature: 0,
  instant: 0,
  sorcery: 0,
  artifact: 0,
  enchantment: 0,
  planeswalker: 0,
  battle: 0,
  land: 0,
});

async function functionalTags(db: ReturnType<typeof createPublicClient>, cardId: number): Promise<string[]> {
  const { data, error } = await db.rpc("cards_functional_tags", { p_card_ids: [cardId] });
  if (error || !data) return [];
  return data
    .filter((row) => row.depth === 0)
    .map((row) => row.label.replace(/-/g, " "))
    .sort((a, b) => Number(b.includes(" ")) - Number(a.includes(" ")))
    .slice(0, 3);
}

function draftSummary(name: string, tags: readonly string[]): string {
  if (tags.length === 0) return `${name} decks, built from the cards the format plays most.`;
  if (tags.length === 1) return `${name} decks are built around ${tags[0]}.`;
  const last = tags[tags.length - 1]!;
  const rest = tags.slice(0, -1).join(", ");
  return `${name} decks are built around ${rest} and ${last}.`;
}

function identityBits(mask: number): number[] {
  const bits: number[] = [];
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) bits.push(i);
  return bits;
}

async function main() {
  const db = createPublicClient();

  const { data: statsRows, error: statsErr } = await db
    .from("commander_stats")
    .select("commander_key_id, deck_count")
    .order("deck_count", { ascending: false })
    .limit(TOP_COMMANDERS * 4);
  if (statsErr || !statsRows) {
    console.error("Failed to load commander_stats:", statsErr?.message);
    process.exit(1);
  }

  const keyIds = statsRows.map((r) => r.commander_key_id);
  const { data: keys, error: keysErr } = await db
    .from("commander_keys")
    .select("id, slug, commander_1, commander_2, color_identity")
    .in("id", keyIds)
    .is("commander_2", null);
  if (keysErr || !keys) {
    console.error("Failed to load commander_keys:", keysErr?.message);
    process.exit(1);
  }

  const keyMap = new Map(keys.map((k) => [k.id, k]));
  const ordered = statsRows.filter((s) => keyMap.has(s.commander_key_id)).slice(0, TOP_COMMANDERS);
  if (ordered.length === 0) {
    console.error("No single commanders with decks found.");
    process.exit(1);
  }

  const commanderIds = ordered.map((s) => keyMap.get(s.commander_key_id)!.commander_1);
  const { data: commanderCards } = await db
    .from("cards")
    .select("id, name, slug, type_line, is_basic_land, color_identity, legal_commander")
    .in("id", commanderIds);
  const commanderMap = new Map((commanderCards ?? []).map((c) => [c.id, c as CardRow]));

  const entries: FeaturedEntry[] = [];

  for (const stat of ordered) {
    const key = keyMap.get(stat.commander_key_id)!;
    const commander = commanderMap.get(key.commander_1);
    if (!commander) continue;

    const { data: cardStats } = await db
      .from("commander_card_stats")
      .select("card_id, inclusion_shrunk")
      .eq("commander_key_id", key.id)
      .order("inclusion_shrunk", { ascending: false })
      .limit(500);
    if (!cardStats || cardStats.length === 0) {
      console.error(`No card stats for ${commander.name}; skipping.`);
      continue;
    }

    const cardIds = cardStats.map((r) => r.card_id);
    const { data: rows } = await db
      .from("cards")
      .select("id, name, slug, type_line, is_basic_land, color_identity, legal_commander")
      .in("id", cardIds)
      .is("deleted_at", null);
    const cardMap = new Map((rows ?? []).map((c) => [c.id, c as CardRow]));

    const ranked = cardStats
      .map((r) => cardMap.get(r.card_id))
      .filter((c): c is CardRow => c !== undefined && c.id !== commander.id && c.legal_commander === "legal");

    const nonlandPool = ranked.filter((c) => cardCategory(c.type_line) !== "land");
    const landPool = ranked.filter((c) => cardCategory(c.type_line) === "land" && !c.is_basic_land);

    const nonlands = nonlandPool.slice(0, TARGET_SIZE - 1 - LAND_TARGET);
    const landTarget = TARGET_SIZE - 1 - nonlands.length;
    const nonbasicLands = landPool.slice(0, Math.min(MAX_NONBASIC_LANDS, landTarget));
    const basicsNeeded = landTarget - nonbasicLands.length;

    const bits = identityBits(key.color_identity);
    const basics: { name: string; count: number }[] = [];
    if (bits.length === 0) {
      if (basicsNeeded > 0) basics.push({ name: "Wastes", count: basicsNeeded });
    } else {
      const per = Math.floor(basicsNeeded / bits.length);
      let extra = basicsNeeded - per * bits.length;
      for (const bit of bits) {
        const count = per + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        if (count > 0) basics.push({ name: BASIC_LANDS[bit]!, count });
      }
    }

    const deckCards: CardRow[] = [commander, ...nonlands, ...nonbasicLands];
    const composition = emptyComposition();
    for (const card of deckCards) composition[cardCategory(card.type_line)]++;
    for (const basic of basics) composition.land += basic.count;

    // Color split: every color in a card's identity counts, empty identity is colorless. Basics are
    // hand-built and have no identity, so they count as colorless too.
    const colorCounts = Object.fromEntries(COLOR_KEYS.map((key) => [key, 0])) as Record<ColorKey, number>;
    for (const card of deckCards) {
      if (card.color_identity === 0) {
        colorCounts.C++;
        continue;
      }
      for (const [bit, key] of Object.entries(COLOR_OF_BIT)) {
        if (card.color_identity & Number(bit)) colorCounts[key]++;
      }
    }
    for (const basic of basics) colorCounts.C += basic.count;

    const total = deckCards.length + basics.reduce((sum, b) => sum + b.count, 0);
    if (total !== TARGET_SIZE) {
      console.error(`${commander.name}: built ${total} cards, expected ${TARGET_SIZE}. Skipping.`);
      continue;
    }

    const tags = await functionalTags(db, commander.id);

    const lines = ["Commander", `1 ${commander.name}`, "", "Deck"];
    for (const card of nonlands) lines.push(`1 ${card.name}`);
    for (const card of nonbasicLands) lines.push(`1 ${card.name}`);
    for (const basic of basics) lines.push(`${basic.count} ${basic.name}`);

    entries.push({
      slug: commander.slug,
      commanderName: commander.name,
      summary: draftSummary(commander.name, tags),
      decklist: lines.join("\n"),
      composition,
      colorCounts,
      cardCount: total,
    });

    console.log(`\n--- ${commander.name} (${stat.deck_count} decks, ${total} cards) ---`);
    console.log(`Composition:`, composition);
    console.log(lines.join("\n"));
  }

  if (entries.length === 0) {
    console.error("No featured decks built.");
    process.exit(1);
  }

  const body = entries
    .map((entry) => {
      const lines = [
        `    slug: ${JSON.stringify(entry.slug)},`,
        `    commanderName: ${JSON.stringify(entry.commanderName)},`,
        `    summary:`,
        `      ${JSON.stringify(entry.summary)},`,
        "    decklist: `" + entry.decklist + "`,",
        "    composition: {",
        ...CATEGORY_ORDER.map((cat) => `      ${cat}: ${entry.composition[cat]},`),
        "    },",
        "    colorCounts: {",
        ...COLOR_KEYS.map((key) => `      ${key}: ${entry.colorCounts[key]},`),
        "    },",
        `    cardCount: ${entry.cardCount},`,
      ];
      return `  {\n${lines.join("\n")}\n  },`;
    })
    .join("\n");

  const file = `import type { CardCategory } from "@mtg/core/contract";

/** A color identity key: the five colors plus colorless. */
export type ColorKey = "W" | "U" | "B" | "R" | "G" | "C";

export interface FeaturedDeck {
  slug: string;
  commanderName: string;
  summary: string;
  decklist: string;
  composition: Record<CardCategory, number>;
  /** Deck cards counted under every color in their identity; empty identity (incl. basics) is C. */
  colorCounts: Record<ColorKey, number>;
  cardCount: number;
}

/**
 * The featured decks on the landing page: the most-built commanders in our own corpus, each built from
 * aggregate play rates rather than any one player's deck (top nonlands by inclusion, most-played
 * nonbasic lands, basics to 100). Generated by scripts/build-featured-decks.ts — do not hand-edit.
 */
export const FEATURED_DECKS: readonly FeaturedDeck[] = [
${body}
] as const;
`;

  const out = new URL("../src/lib/featured-decks.ts", import.meta.url);
  writeFileSync(out, file, "utf8");
  console.log(`\nWrote ${out.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
