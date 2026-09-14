import type { CorpusConfidence, CorpusEvidence } from "@mtg/core/contract";
import { commanderShare, corpusConfidence, decksSinceRelease, shrunkInclusion, type CommanderCardRate } from "@mtg/core/scoring";
import type { PublicClient } from "./supabase";

const DEFAULT_SETTINGS = { shrinkAlpha: 20, minDecks: 50, fullDecks: 100 };
type CorpusSettings = typeof DEFAULT_SETTINGS;
type DeckMonths = Record<string, number>;

const IDENTITIES = 32;

export interface CommanderCorpus {
  /** False until the corpus has been aggregated; then no card gets a corpus signal. */
  available: boolean;
  settings: CorpusSettings;
  /** The deck's own commander key, when that commander (or pair) has corpus decks. */
  keyId: number | null;
  slug: string | null;
  /** Keys whose decks count for this deck: the exact key, plus each partner's own decks when the pair has too few. */
  sourceKeyIds: number[];
  deckCount: number;
  /** Those decks by last-updated month, to count only decks updated since a card's release. */
  deckMonths: DeckMonths;
  confidence: CorpusConfidence;
}

export interface CardCorpus {
  /** Share of eligible corpus decks (the card's colors allow it, updated since its release) that run it. */
  baseline: number;
  baselineDeckCount: number;
  /** The commander's decks updated since the card's release. */
  commanderDeckCount: number;
  /** The commander's decks, shrunk toward the baseline; null when none could have run the card. */
  commanderRate: CommanderCardRate | null;
  /** Marked limited when too few decks, anywhere, could have run the card. */
  evidence: CorpusEvidence;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function parseSettings(value: unknown): CorpusSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const read = (key: keyof CorpusSettings) => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_SETTINGS[key];
  };
  return { shrinkAlpha: read("shrinkAlpha"), minDecks: read("minDecks"), fullDecks: read("fullDecks") };
}

function parseMonths(value: unknown): DeckMonths {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

function addMonths(total: DeckMonths, months: DeckMonths): DeckMonths {
  for (const [month, count] of Object.entries(months)) total[month] = (total[month] ?? 0) + count;
  return total;
}

/** Finds the corpus decks that describe a deck's commander (or partner pair). */
export async function loadCommanderCorpus(db: PublicClient, commanderIds: readonly number[]): Promise<CommanderCorpus> {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const idList = ids.join(",");
  const [configResult, probeResult, keysResult] = await Promise.all([
    db.rpc("get_public_config", { p_key: "corpus" }),
    db.from("card_global_stats").select("card_id").limit(1),
    ids.length > 0 && ids.length <= 2
      ? db.from("commander_keys").select("id, slug, commander_1, commander_2").or(`commander_1.in.(${idList}),commander_2.in.(${idList})`)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (configResult.error) throw new Error(`Loading corpus settings failed: ${configResult.error.message}`);
  if (probeResult.error) throw new Error(`Checking the corpus failed: ${probeResult.error.message}`);
  if (keysResult.error) throw new Error(`Loading commander keys failed: ${keysResult.error.message}`);

  const settings = parseSettings(configResult.data);
  const available = probeResult.data.length > 0;
  const none: CommanderCorpus = {
    available,
    settings,
    keyId: null,
    slug: null,
    sourceKeyIds: [],
    deckCount: 0,
    deckMonths: {},
    confidence: "none",
  };
  const keys = keysResult.data ?? [];
  const exact = keys.find((k) => k.commander_1 === ids[0] && k.commander_2 === (ids[1] ?? null)) ?? null;
  const singles = ids.length === 2 ? keys.filter((k) => k.commander_2 === null && ids.includes(k.commander_1)) : [];
  const candidates = [...(exact ? [exact] : []), ...singles];
  if (!available || candidates.length === 0) return none;

  const { data: statRows, error } = await db
    .from("commander_stats")
    .select("commander_key_id, deck_count, deck_months")
    .in(
      "commander_key_id",
      candidates.map((k) => k.id),
    );
  if (error) throw new Error(`Loading commander stats failed: ${error.message}`);
  const statsByKey = new Map(statRows.map((r) => [r.commander_key_id, r]));
  const decksOf = (id: number) => statsByKey.get(id)?.deck_count ?? 0;
  const exactDecks = exact ? decksOf(exact.id) : 0;

  // A pair with enough decks of its own stands alone; otherwise each partner's single-commander decks fill in.
  const sources = exact && exactDecks >= settings.minDecks ? [exact] : candidates;
  const sourceKeyIds = sources.map((k) => k.id).filter((id) => decksOf(id) > 0);
  const deckCount = sourceKeyIds.reduce((sum, id) => sum + decksOf(id), 0);
  const deckMonths = sourceKeyIds.reduce((total, id) => addMonths(total, parseMonths(statsByKey.get(id)?.deck_months)), {} as DeckMonths);
  return {
    available,
    settings,
    keyId: exact && exactDecks > 0 ? exact.id : null,
    slug: exact && exactDecks > 0 ? exact.slug : null,
    sourceKeyIds,
    deckCount,
    deckMonths,
    confidence: corpusConfidence(deckCount, settings),
  };
}

/**
 * Play rates for candidate cards: the baseline everywhere, plus the commander's own decks when it has any. Both count
 * only decks updated since the card's release, so new cards aren't judged by decks built before they existed.
 */
export async function loadCardCorpus(
  db: PublicClient,
  corpus: CommanderCorpus,
  cardIds: readonly number[],
): Promise<Map<number, CardCorpus>> {
  const ids = [...new Set(cardIds)];
  if (!corpus.available || ids.length === 0) return new Map();

  const [globalResult, commanderResult, cardsResult, printingsResult, identityResult] = await Promise.all([
    db.from("card_global_stats").select("card_id, decks_with, eligible_decks, rate").in("card_id", ids),
    corpus.sourceKeyIds.length > 0
      ? db.from("commander_card_stats").select("card_id, decks_with").in("commander_key_id", corpus.sourceKeyIds).in("card_id", ids)
      : Promise.resolve({ data: [] as { card_id: number; decks_with: number }[], error: null }),
    db.from("cards").select("id, released_at, color_identity").in("id", ids),
    db.from("card_stats").select("card_id, first_printed_at").in("card_id", ids),
    db.from("corpus_identity_stats").select("color_identity, deck_months"),
  ]);
  if (globalResult.error) throw new Error(`Loading card play rates failed: ${globalResult.error.message}`);
  if (commanderResult.error) throw new Error(`Loading commander play rates failed: ${commanderResult.error.message}`);
  if (cardsResult.error) throw new Error(`Loading card release dates failed: ${cardsResult.error.message}`);
  if (printingsResult.error) throw new Error(`Loading first printings failed: ${printingsResult.error.message}`);
  if (identityResult.error) throw new Error(`Loading corpus deck counts failed: ${identityResult.error.message}`);

  const global = new Map(globalResult.data.map((r) => [r.card_id, r]));
  // First printing, not cards.released_at: Oracle Cards dates a card by its representative (often latest) printing.
  const firstPrinted = new Map(printingsResult.data.map((r) => [r.card_id, r.first_printed_at]));
  const cardFacts = new Map(
    cardsResult.data.map((r) => [
      r.id,
      { releaseMonth: (firstPrinted.get(r.id) ?? r.released_at)?.slice(0, 7) ?? null, identity: r.color_identity },
    ]),
  );
  const monthsByIdentity = new Map(identityResult.data.map((r) => [r.color_identity, parseMonths(r.deck_months)]));
  const commanderDecks = new Map<number, number>();
  for (const r of commanderResult.data ?? []) commanderDecks.set(r.card_id, (commanderDecks.get(r.card_id) ?? 0) + r.decks_with);

  // Cards no deck runs have no baseline row; count the decks that could have run them from the identity histograms.
  const baselineDecksFor = (identity: number, releaseMonth: string | null) => {
    let total = 0;
    for (let deckIdentity = 0; deckIdentity < IDENTITIES; deckIdentity++) {
      if ((identity & ~deckIdentity) === 0) total += decksSinceRelease(monthsByIdentity.get(deckIdentity) ?? {}, releaseMonth);
    }
    return total;
  };

  // Same test as corpusComponent's null result: no usable play rate from the commander's decks or from decks overall.
  const isLimited = (commanderDecks: number, baselineDecks: number) =>
    commanderShare(commanderDecks, corpus.settings) === 0 && baselineDecks < corpus.settings.minDecks;

  return new Map(
    ids.map((id): [number, CardCorpus] => {
      const g = global.get(id);
      const facts = cardFacts.get(id);
      const releaseMonth = facts?.releaseMonth ?? null;
      const baseline = g?.rate ?? 0;
      const baselineDeckCount = g?.eligible_decks ?? baselineDecksFor(facts?.identity ?? 0, releaseMonth);
      const decksWith = commanderDecks.get(id) ?? 0;
      const commanderDeckCount = corpus.deckCount > 0 ? Math.max(decksSinceRelease(corpus.deckMonths, releaseMonth), decksWith) : 0;

      if (commanderDeckCount > 0) {
        const inclusion = shrunkInclusion(decksWith, commanderDeckCount, baseline, corpus.settings.shrinkAlpha);
        return [
          id,
          {
            baseline,
            baselineDeckCount,
            commanderDeckCount,
            commanderRate: { inclusion, synergy: inclusion - baseline },
            evidence: {
              scope: "commander",
              decksWith,
              commanderDeckCount,
              inclusionRate: round3(decksWith / commanderDeckCount),
              synergy: round3(inclusion - baseline),
              limited: isLimited(commanderDeckCount, baselineDeckCount),
            },
          },
        ];
      }
      return [
        id,
        {
          baseline,
          baselineDeckCount,
          commanderDeckCount: 0,
          commanderRate: null,
          evidence: {
            scope: "colors",
            decksWith: g?.decks_with ?? 0,
            commanderDeckCount: baselineDeckCount,
            inclusionRate: round3(baseline),
            synergy: 0,
            limited: isLimited(0, baselineDeckCount),
          },
        },
      ];
    }),
  );
}
