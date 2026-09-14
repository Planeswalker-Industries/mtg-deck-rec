import type { CorpusConfidence, CorpusEvidence } from "@mtg/core/contract";
import { corpusConfidence, shrunkInclusion, type CommanderCardRate } from "@mtg/core/scoring";
import type { PublicClient } from "./supabase";

const DEFAULT_SETTINGS = { shrinkAlpha: 20, minDecks: 50, fullDecks: 100 };
type CorpusSettings = typeof DEFAULT_SETTINGS;

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
  confidence: CorpusConfidence;
}

export interface CardCorpus {
  /** Share of corpus decks whose color identity allows the card that run it. */
  baseline: number;
  /** The commander's decks, shrunk toward the baseline; null when the commander has no corpus decks. */
  commanderRate: CommanderCardRate | null;
  /** Null when the card appears in no corpus deck and the commander has none to compare against. */
  evidence: CorpusEvidence | null;
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
  const none: CommanderCorpus = { available, settings, keyId: null, slug: null, sourceKeyIds: [], deckCount: 0, confidence: "none" };
  const keys = keysResult.data ?? [];
  const exact = keys.find((k) => k.commander_1 === ids[0] && k.commander_2 === (ids[1] ?? null)) ?? null;
  const singles = ids.length === 2 ? keys.filter((k) => k.commander_2 === null && ids.includes(k.commander_1)) : [];
  const candidates = [...(exact ? [exact] : []), ...singles];
  if (!available || candidates.length === 0) return none;

  const { data: statRows, error } = await db
    .from("commander_stats")
    .select("commander_key_id, deck_count")
    .in(
      "commander_key_id",
      candidates.map((k) => k.id),
    );
  if (error) throw new Error(`Loading commander stats failed: ${error.message}`);
  const decksByKey = new Map(statRows.map((r) => [r.commander_key_id, r.deck_count]));
  const exactDecks = exact ? (decksByKey.get(exact.id) ?? 0) : 0;

  // A pair with enough decks of its own stands alone; otherwise each partner's single-commander decks fill in.
  const sources = exact && exactDecks >= settings.minDecks ? [exact] : candidates;
  const sourceKeyIds = sources.map((k) => k.id).filter((id) => (decksByKey.get(id) ?? 0) > 0);
  const deckCount = sourceKeyIds.reduce((sum, id) => sum + (decksByKey.get(id) ?? 0), 0);
  return {
    available,
    settings,
    keyId: exact && exactDecks > 0 ? exact.id : null,
    slug: exact && exactDecks > 0 ? exact.slug : null,
    sourceKeyIds,
    deckCount,
    confidence: corpusConfidence(deckCount, settings),
  };
}

/** Play rates for candidate cards: the baseline everywhere, plus the commander's own decks when it has any. */
export async function loadCardCorpus(
  db: PublicClient,
  corpus: CommanderCorpus,
  cardIds: readonly number[],
): Promise<Map<number, CardCorpus>> {
  const ids = [...new Set(cardIds)];
  if (!corpus.available || ids.length === 0) return new Map();

  const [globalResult, commanderResult] = await Promise.all([
    db.from("card_global_stats").select("card_id, decks_with, eligible_decks, rate").in("card_id", ids),
    corpus.sourceKeyIds.length > 0
      ? db.from("commander_card_stats").select("card_id, decks_with").in("commander_key_id", corpus.sourceKeyIds).in("card_id", ids)
      : Promise.resolve({ data: [] as { card_id: number; decks_with: number }[], error: null }),
  ]);
  if (globalResult.error) throw new Error(`Loading card play rates failed: ${globalResult.error.message}`);
  if (commanderResult.error) throw new Error(`Loading commander play rates failed: ${commanderResult.error.message}`);

  const global = new Map(globalResult.data.map((r) => [r.card_id, r]));
  const commanderDecks = new Map<number, number>();
  for (const r of commanderResult.data ?? []) commanderDecks.set(r.card_id, (commanderDecks.get(r.card_id) ?? 0) + r.decks_with);

  return new Map(
    ids.map((id): [number, CardCorpus] => {
      const g = global.get(id);
      const baseline = g?.rate ?? 0;
      if (corpus.deckCount === 0) {
        return [
          id,
          {
            baseline,
            commanderRate: null,
            evidence: g ? { decksWith: g.decks_with, commanderDeckCount: g.eligible_decks, inclusionRate: round3(baseline), synergy: 0 } : null,
          },
        ];
      }
      const decksWith = commanderDecks.get(id) ?? 0;
      const inclusion = shrunkInclusion(decksWith, corpus.deckCount, baseline, corpus.settings.shrinkAlpha);
      return [
        id,
        {
          baseline,
          commanderRate: { inclusion, synergy: inclusion - baseline },
          evidence: {
            decksWith,
            commanderDeckCount: corpus.deckCount,
            inclusionRate: round3(decksWith / corpus.deckCount),
            synergy: round3(inclusion - baseline),
          },
        },
      ];
    }),
  );
}
