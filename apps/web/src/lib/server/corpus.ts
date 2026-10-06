import type { CommanderKeyRef, CorpusConfidence, CorpusEvidence } from "@mtg/core/contract";
import {
  pickCorpusSources,
  servingSettings,
  sourcesConfidence,
  DEFAULT_SERVING_SETTINGS,
  type CommanderCardRate,
  type CorpusKey,
  type CorpusSource,
} from "@mtg/core/scoring";
import { cachedConfig } from "./config-cache";
import type { PublicClient } from "./supabase";

// The scoring settings' defaults are @mtg/core's, which the precompute worker reads too (externalPriorShare 0 keeps
// the EDHREC prior off). severeSynergyScore only decides which cuts are severe, so it stays here.
const DEFAULT_SETTINGS = {
  ...DEFAULT_SERVING_SETTINGS,
  severeSynergyScore: 0.2,
};
type CorpusSettings = typeof DEFAULT_SETTINGS;
type DeckMonths = Record<string, number>;

/** A Commander deck has one commander or a partner pair, so more ids than this is not a deck we can key a page by. */
const MAX_COMMANDERS = 2;

export interface CommanderCorpus {
  /** False until the corpus has been aggregated; then no card gets a corpus signal. */
  available: boolean;
  settings: CorpusSettings;
  /** The deck's own commander key, when that commander (or pair) has corpus decks. */
  keyId: number | null;
  /**
   * A commander key exists for exactly these commanders, decks or not. The precompute worker scores every such key and
   * every commander on its own; a pair without one is combined from its partners' totals (serving.ts).
   */
  exactKey: boolean;
  slug: string | null;
  /** Keys whose decks count for this deck, with their weights: see `pickCorpusSources`. */
  sources: CorpusSource[];
  sourceKeyIds: number[];
  /** Decks with exactly these commanders. */
  ownDeckCount: number;
  /** Other decks led by one of these commanders, borrowed at `settings.partnerPoolWeight` each. */
  borrowedDeckCount: number;
  /** Own decks plus borrowed decks at their weight: what confidence and the commander share are judged on. */
  effectiveDeckCount: number;
  /** Average cards per deck in each tracked role (by role tag id), across those decks at their weights. */
  roleProfile: Record<string, number>;
  confidence: CorpusConfidence;
}

export interface CardCorpus {
  /** Share of eligible corpus decks (the card's colors allow it, updated since its release) that run it. */
  baseline: number;
  baselineDeckCount: number;
  /** The commander's decks that could have run the card (colors allow it, updated since its release), at their weights. */
  commanderDeckCount: number;
  /** The commander's decks, shrunk toward the prior; null when none could have run the card and there is no prior. */
  commanderRate: CommanderCardRate | null;
  /** An external source (EDHREC) publishes a rate for this card under this commander, and it shaped `commanderRate`. */
  hasExternalPrior: boolean;
  /** Marked limited when too few decks, anywhere, could have run the card. */
  evidence: CorpusEvidence;
}

function parseSettings(value: unknown): CorpusSettings {
  const severe = (value as Record<string, unknown> | null)?.severeSynergyScore;
  return {
    ...servingSettings(value),
    severeSynergyScore: typeof severe === "number" && Number.isFinite(severe) ? severe : DEFAULT_SETTINGS.severeSynergyScore,
  };
}

function parseNumberRecord(value: unknown): DeckMonths {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

/** The deck counts and confidence a CommanderKeyRef reports for this corpus. */
export function commanderKeyCounts(corpus: CommanderCorpus | null): Pick<CommanderKeyRef, "deckCount" | "borrowedDeckCount" | "confidence"> {
  if (!corpus) return { deckCount: 0, confidence: "none" };
  return {
    deckCount: corpus.ownDeckCount,
    ...(corpus.borrowedDeckCount > 0 ? { borrowedDeckCount: corpus.borrowedDeckCount } : {}),
    confidence: corpus.confidence,
  };
}

/** The corpus settings and whether any stats exist yet: read per server instance at most once a minute. */
export interface CorpusConfig {
  settings: CorpusSettings;
  /** False until the corpus has been aggregated. */
  available: boolean;
}

export function loadCorpusConfig(db: PublicClient): Promise<CorpusConfig> {
  return cachedConfig("corpus", async () => {
    const [configResult, probeResult] = await Promise.all([
      db.rpc("get_public_config", { p_key: "corpus" }),
      db.from("card_global_stats").select("card_id").limit(1),
    ]);
    if (configResult.error) throw new Error(`Loading corpus settings failed: ${configResult.error.message}`);
    if (probeResult.error) throw new Error(`Checking the corpus failed: ${probeResult.error.message}`);
    return { settings: parseSettings(configResult.data), available: probeResult.data.length > 0 };
  });
}

/** Decks per month for each colour identity (corpus_identity_stats), for cards no deck runs. Cached like the settings. */
export function loadIdentityMonths(db: PublicClient): Promise<Map<number, DeckMonths>> {
  return cachedConfig("corpus-identity-months", async () => {
    const { data, error } = await db.from("corpus_identity_stats").select("color_identity, deck_months");
    if (error) throw new Error(`Loading corpus deck counts failed: ${error.message}`);
    return new Map(data.map((r) => [r.color_identity, parseNumberRecord(r.deck_months)]));
  });
}

/** A commander key involving the deck's commanders, with its stats (none once its decks are gone). */
export interface CommanderKeyRow {
  id: number;
  slug: string;
  commander_1: number;
  commander_2: number | null;
  color_identity: number;
  commander_stats: { deck_count: number; deck_months: unknown; role_profile: unknown } | null;
}

/**
 * Every key either commander leads or shares, with its stats, in one read (the stats are embedded through their key).
 * In id order, as the precompute worker reads them, so borrowed sources are summed in the same order everywhere.
 */
async function readCommanderKeys(db: PublicClient, ids: readonly number[]): Promise<CommanderKeyRow[]> {
  if (ids.length === 0 || ids.length > MAX_COMMANDERS) return [];
  const idList = ids.join(",");
  const { data, error } = await db
    .from("commander_keys")
    .select("id, slug, commander_1, commander_2, color_identity, commander_stats(deck_count, deck_months, role_profile)")
    .or(`commander_1.in.(${idList}),commander_2.in.(${idList})`)
    .order("id");
  if (error) throw new Error(`Loading commander keys failed: ${error.message}`);
  return data as CommanderKeyRow[];
}

/**
 * The corpus decks that describe these commanders, from their keys: their own key, borrowing from other pairings when
 * it has too few (pickCorpusSources). Pure, so both read paths and the tests build it the same way.
 */
export function commanderCorpusFrom(commanderIds: readonly number[], keys: readonly CommanderKeyRow[], config: CorpusConfig): CommanderCorpus {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const { settings, available } = config;
  const exactKey = keys.some((k) => k.commander_1 === ids[0] && k.commander_2 === (ids[1] ?? null));
  const none: CommanderCorpus = {
    available,
    settings,
    keyId: null,
    exactKey,
    slug: null,
    sources: [],
    sourceKeyIds: [],
    ownDeckCount: 0,
    borrowedDeckCount: 0,
    effectiveDeckCount: 0,
    roleProfile: {},
    confidence: "none",
  };
  if (!available || keys.length === 0) return none;

  const statsByKey = new Map(keys.map((k) => [k.id, k.commander_stats]));
  const corpusKeys = keys.map(
    (k): CorpusKey => ({
      id: k.id,
      commander1: k.commander_1,
      commander2: k.commander_2,
      identity: k.color_identity,
      deckCount: k.commander_stats?.deck_count ?? 0,
      deckMonths: parseNumberRecord(k.commander_stats?.deck_months),
    }),
  );
  const picked = pickCorpusSources(ids, corpusKeys, settings);
  if (picked.sources.length === 0) return none;

  // Each key's averages weighted by its decks at their weight, so own and borrowed decks count as they do for play rates.
  const roleTotals: Record<string, number> = {};
  for (const source of picked.sources) {
    for (const [role, average] of Object.entries(parseNumberRecord(statsByKey.get(source.id)?.role_profile))) {
      roleTotals[role] = (roleTotals[role] ?? 0) + average * source.deckCount * source.weight;
    }
  }
  const roleProfile = Object.fromEntries(
    Object.entries(roleTotals).map(([role, total]) => [role, total / Math.max(picked.effectiveDeckCount, 1)]),
  );
  return {
    available,
    settings,
    keyId: picked.own?.id ?? null,
    exactKey,
    slug: keys.find((k) => k.id === picked.own?.id)?.slug ?? null,
    sources: picked.sources,
    sourceKeyIds: picked.sources.map((s) => s.id),
    ownDeckCount: picked.ownDeckCount,
    borrowedDeckCount: picked.borrowedDeckCount,
    effectiveDeckCount: picked.effectiveDeckCount,
    roleProfile,
    confidence: sourcesConfidence(picked, settings),
  };
}

/**
 * Finds the corpus decks that describe a deck's commander (or partner pair), borrowing from other pairings when it has
 * too few. One read: the settings come from the per-instance cache.
 */
export async function loadCommanderCorpus(db: PublicClient, commanderIds: readonly number[]): Promise<CommanderCorpus> {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const [config, keys] = await Promise.all([loadCorpusConfig(db), readCommanderKeys(db, ids)]);
  return commanderCorpusFrom(ids, keys, config);
}
