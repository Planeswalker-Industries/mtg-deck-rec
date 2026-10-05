import type { CommanderKeyRef, CorpusConfidence, CorpusEvidence } from "@mtg/core/contract";
import {
  commanderShareWithPrior,
  decksSinceRelease,
  pickCorpusSources,
  shrunkInclusion,
  sourceDecksSinceRelease,
  sourcesConfidence,
  type CommanderCardRate,
  type CorpusKey,
  type CorpusSource,
} from "@mtg/core/scoring";
import { colorsToMask } from "@mtg/core/search";
import { fromIndex } from "./search-index";
import type { PublicClient } from "./supabase";

// externalPriorShare 0 means the EDHREC prior is off: the code path exists but changes no score until
// app_config.corpus sets it. See corpusComponent's CorpusThresholds for what it does and how to pick a value.
const DEFAULT_SETTINGS = {
  shrinkAlpha: 20,
  minDecks: 50,
  fullDecks: 100,
  partnerPoolWeight: 0.25,
  severeSynergyScore: 0.2,
  externalPriorShare: 0,
};
type CorpusSettings = typeof DEFAULT_SETTINGS;
type DeckMonths = Record<string, number>;

const IDENTITIES = 32;

/** A Commander deck has one commander or a partner pair, so more ids than this is not a deck we can key a page by. */
const MAX_COMMANDERS = 2;

export interface CommanderCorpus {
  /** False until the corpus has been aggregated; then no card gets a corpus signal. */
  available: boolean;
  settings: CorpusSettings;
  /** The deck's own commander key, when that commander (or pair) has corpus decks. */
  keyId: number | null;
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

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function parseSettings(value: unknown): CorpusSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const read = (key: keyof CorpusSettings) => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_SETTINGS[key];
  };
  return {
    shrinkAlpha: read("shrinkAlpha"),
    minDecks: read("minDecks"),
    fullDecks: read("fullDecks"),
    partnerPoolWeight: read("partnerPoolWeight"),
    severeSynergyScore: read("severeSynergyScore"),
    externalPriorShare: read("externalPriorShare"),
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

/** Finds the corpus decks that describe a deck's commander (or partner pair), borrowing from other pairings when it has too few. */
export async function loadCommanderCorpus(db: PublicClient, commanderIds: readonly number[]): Promise<CommanderCorpus> {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const idList = ids.join(",");
  const [configResult, probeResult, keysResult] = await Promise.all([
    db.rpc("get_public_config", { p_key: "corpus" }),
    db.from("card_global_stats").select("card_id").limit(1),
    ids.length > 0 && ids.length <= 2
      ? db
          .from("commander_keys")
          .select("id, slug, commander_1, commander_2, color_identity")
          .or(`commander_1.in.(${idList}),commander_2.in.(${idList})`)
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
    sources: [],
    sourceKeyIds: [],
    ownDeckCount: 0,
    borrowedDeckCount: 0,
    effectiveDeckCount: 0,
    roleProfile: {},
    confidence: "none",
  };
  const keys = keysResult.data ?? [];
  if (!available || keys.length === 0) return none;

  const { data: statRows, error } = await db
    .from("commander_stats")
    .select("commander_key_id, deck_count, deck_months, role_profile")
    .in(
      "commander_key_id",
      keys.map((k) => k.id),
    );
  if (error) throw new Error(`Loading commander stats failed: ${error.message}`);
  const statsByKey = new Map(statRows.map((r) => [r.commander_key_id, r]));
  const corpusKeys = keys.map(
    (k): CorpusKey => ({
      id: k.id,
      commander1: k.commander_1,
      commander2: k.commander_2,
      identity: k.color_identity,
      deckCount: statsByKey.get(k.id)?.deck_count ?? 0,
      deckMonths: parseNumberRecord(statsByKey.get(k.id)?.deck_months),
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

interface GlobalRate {
  card_id: number;
  decks_with: number;
  eligible_decks: number;
  rate: number;
}

interface CardFacts {
  releaseMonth: string | null;
  identity: number;
}

/** Each source key's decks count at its own weight, and a card's total is the sum across the keys that ran it. */
function weightedCommanderDecks(
  corpus: CommanderCorpus,
  rows: readonly { commander_key_id: number; card_id: number; decks_with: number }[],
): Map<number, number> {
  const weightByKey = new Map(corpus.sources.map((s) => [s.id, s.weight]));
  const decks = new Map<number, number>();
  for (const r of rows) decks.set(r.card_id, (decks.get(r.card_id) ?? 0) + (weightByKey.get(r.commander_key_id) ?? 0) * r.decks_with);
  return decks;
}

/**
 * The four card-shaped reads this function needs, from the search index: the baseline rate, the release month and
 * the colour identity all sit on a card document, and the commander's own counts are their own collection.
 *
 * **All or nothing.** A card the index hasn't got yet would otherwise be scored as if no deck could ever have run it
 * — not "unknown" but "unplayed", which is the one mistake `corpusComponent` is built to avoid. So a short answer
 * sends the whole call back to Postgres rather than quietly mixing sources.
 */
async function factsFromIndex(
  corpus: CommanderCorpus,
  ids: readonly number[],
): Promise<{ global: Map<number, GlobalRate>; cardFacts: Map<number, CardFacts>; commanderDecks: Map<number, number> } | null> {
  const loaded = await fromIndex("Card play rates", async (index) => {
    const [cards, commanderCards] = await Promise.all([
      index.cardsByID(ids),
      index.commanderCardRates({ keyIds: corpus.sourceKeyIds, cardIds: ids }),
    ]);
    return { cards, commanderCards };
  });
  if (!loaded || loaded.value.cards.length !== ids.length) return null;

  const global = new Map<number, GlobalRate>();
  const cardFacts = new Map<number, CardFacts>();
  for (const doc of loaded.value.cards) {
    // Only when a card_global_stats row exists. A card with no row is one the baseline says nothing about, and the
    // caller counts its eligible decks from the identity histograms instead of reading a zero as "nobody plays it".
    if (doc.has_baseline) {
      global.set(doc.card_id, {
        card_id: doc.card_id,
        decks_with: doc.baseline_decks_with,
        eligible_decks: doc.baseline_eligible_decks,
        rate: doc.baseline_rate,
      });
    }
    // First printing, not released_at: Oracle Cards dates a card by its representative (often latest) printing.
    const month = doc.first_printed_at ?? doc.released_at ?? null;
    cardFacts.set(doc.card_id, {
      releaseMonth: month ? month.slice(0, 7) : null,
      identity: doc.color_identity ?? colorsToMask(doc.colors),
    });
  }

  return {
    global,
    cardFacts,
    commanderDecks: weightedCommanderDecks(
      corpus,
      loaded.value.commanderCards.map((d) => ({ commander_key_id: d.key_id, card_id: d.card_id, decks_with: d.decks_with })),
    ),
  };
}

/**
 * EDHREC's published inclusion for these cards under *exactly* these commanders, as a shrink target for commanders we
 * hold few or no decks for.
 *
 * Exactly these commanders, never a borrowed pairing: EDHREC publishes a page per commander or pair, and a partner's
 * solo page describes different decks. Borrowing is what `pickCorpusSources` does with our own decks, and mixing the
 * two ideas would silently credit one pairing's numbers to another.
 *
 * Returns an empty map when the prior is switched off, when no page exists for these commanders, or on a read error:
 * the prior is an improvement on the colour baseline, never a dependency, so a failure here falls back to what the app
 * did before rather than failing the request. Same stance as `fromIndex` returning null.
 */
async function loadExternalPrior(
  db: PublicClient,
  settings: CorpusSettings,
  commanderIds: readonly number[],
  cardIds: readonly number[],
): Promise<Map<number, number>> {
  const empty = new Map<number, number>();
  if (settings.externalPriorShare <= 0 || commanderIds.length === 0 || cardIds.length === 0) return empty;
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  if (ids.length > MAX_COMMANDERS) return empty;

  // Through the function, not the tables: `corpus.edhrec_commanders` and `corpus.edhrec_commander_cards` are out of
  // reach of anon and authenticated, so a table read here would be denied on every request - and, caught below, would
  // make the prior a permanent silent no-op that looked like it was working.
  const { data, error } = await db.rpc("edhrec_card_priors", {
    p_commander_ids: ids,
    p_card_ids: [...new Set(cardIds)],
  });
  if (error) {
    // The prior is an improvement on the colour baseline, never a dependency, so a failure falls back to what the app
    // did before rather than failing the request - the same stance as `fromIndex` returning null. Logged loudly,
    // because the one way this can be wrong is silently.
    console.warn("[corpus] the EDHREC prior could not be read; falling back to the colour baseline", error.message);
    return empty;
  }
  const rates = (data ?? {}) as unknown as Record<string, number>;
  return new Map(Object.entries(rates).map(([cardId, inclusion]) => [Number(cardId), inclusion]));
}

/**
 * Play rates for candidate cards: the baseline everywhere, plus the commander's own decks when it has any. Both count
 * only decks updated since the card's release, so new cards aren't judged by decks built before they existed. Borrowed
 * decks count at their weight, and only where their colors allow the card.
 */
export async function loadCardCorpus(
  db: PublicClient,
  corpus: CommanderCorpus,
  cardIds: readonly number[],
  /** The deck's commanders, for the external prior. Omitted means no prior: the colour baseline as before. */
  commanderIds: readonly number[] = [],
): Promise<Map<number, CardCorpus>> {
  const ids = [...new Set(cardIds)];
  if (!corpus.available || ids.length === 0) return new Map();

  // 32 rows, read whole, and it is the one part of this that is not card-shaped: it stays a query either way.
  const identityPromise = db.from("corpus_identity_stats").select("color_identity, deck_months");

  // Started alongside the index read rather than after it: it is one small indexed lookup and the request is already
  // paying for a round trip.
  const priorPromise = loadExternalPrior(db, corpus.settings, commanderIds, ids);
  const indexed = await factsFromIndex(corpus, ids);
  const identityResult = await identityPromise;
  const prior = await priorPromise;
  if (identityResult.error) throw new Error(`Loading corpus deck counts failed: ${identityResult.error.message}`);

  let global: Map<number, GlobalRate>;
  let cardFacts: Map<number, CardFacts>;
  let commanderDecks: Map<number, number>;

  if (indexed) {
    ({ global, cardFacts, commanderDecks } = indexed);
  } else {
    const [globalResult, commanderResult, cardsResult, printingsResult] = await Promise.all([
      db.from("card_global_stats").select("card_id, decks_with, eligible_decks, rate").in("card_id", ids),
      corpus.sourceKeyIds.length > 0
        ? db
            .from("commander_card_stats")
            .select("commander_key_id, card_id, decks_with")
            .in("commander_key_id", corpus.sourceKeyIds)
            .in("card_id", ids)
        : Promise.resolve({ data: [] as { commander_key_id: number; card_id: number; decks_with: number }[], error: null }),
      db.from("cards").select("id, released_at, color_identity").in("id", ids),
      db.from("card_stats").select("card_id, first_printed_at").in("card_id", ids),
    ]);
    if (globalResult.error) throw new Error(`Loading card play rates failed: ${globalResult.error.message}`);
    if (commanderResult.error) throw new Error(`Loading commander play rates failed: ${commanderResult.error.message}`);
    if (cardsResult.error) throw new Error(`Loading card release dates failed: ${cardsResult.error.message}`);
    if (printingsResult.error) throw new Error(`Loading first printings failed: ${printingsResult.error.message}`);

    global = new Map(globalResult.data.map((r) => [r.card_id, r]));
    // First printing, not cards.released_at: Oracle Cards dates a card by its representative (often latest) printing.
    const firstPrinted = new Map(printingsResult.data.map((r) => [r.card_id, r.first_printed_at]));
    cardFacts = new Map(
      cardsResult.data.map((r) => [
        r.id,
        { releaseMonth: (firstPrinted.get(r.id) ?? r.released_at)?.slice(0, 7) ?? null, identity: r.color_identity },
      ]),
    );
    commanderDecks = weightedCommanderDecks(corpus, commanderResult.data ?? []);
  }

  const monthsByIdentity = new Map(identityResult.data.map((r) => [r.color_identity, parseNumberRecord(r.deck_months)]));
  const pooled = corpus.borrowedDeckCount > 0;

  // Cards no deck runs have no baseline row; count the decks that could have run them from the identity histograms.
  const baselineDecksFor = (identity: number, releaseMonth: string | null) => {
    let total = 0;
    for (let deckIdentity = 0; deckIdentity < IDENTITIES; deckIdentity++) {
      if ((identity & ~deckIdentity) === 0) total += decksSinceRelease(monthsByIdentity.get(deckIdentity) ?? {}, releaseMonth);
    }
    return total;
  };

  // Same test as corpusComponent's null result: no usable play rate from the commander's decks or from decks overall,
  // and no external rate for this commander either.
  const isLimited = (commanderDecks: number, baselineDecks: number, hasPrior: boolean) =>
    commanderShareWithPrior(commanderDecks, corpus.settings, hasPrior) === 0 && baselineDecks < corpus.settings.minDecks && !hasPrior;

  return new Map(
    ids.map((id): [number, CardCorpus] => {
      const g = global.get(id);
      const facts = cardFacts.get(id);
      const releaseMonth = facts?.releaseMonth ?? null;
      const baseline = g?.rate ?? 0;
      const baselineDeckCount = g?.eligible_decks ?? baselineDecksFor(facts?.identity ?? 0, releaseMonth);
      const decksWith = commanderDecks.get(id) ?? 0;
      const commanderDeckCount = Math.max(sourceDecksSinceRelease(corpus.sources, facts?.identity ?? 0, releaseMonth), decksWith);

      const external = prior.get(id);
      const hasExternalPrior = external !== undefined;
      // What our own decks are shrunk toward. EDHREC's rate for this commander when it has one, the colour baseline
      // otherwise: this is the substitution `spike:edhrec:prior` measured.
      const shrinkTarget = external ?? baseline;

      if (commanderDeckCount > 0) {
        const inclusion = shrunkInclusion(decksWith, commanderDeckCount, shrinkTarget, corpus.settings.shrinkAlpha);
        return [
          id,
          {
            baseline,
            baselineDeckCount,
            commanderDeckCount,
            // Synergy stays measured against the colour baseline p0, never against the prior, in both arms of the
            // holdout test. Against the prior it would be ~0 for every card a commander with no decks of its own, and
            // commanderCorpusScore is 60% synergy - the ranking would collapse.
            commanderRate: { inclusion, synergy: inclusion - baseline },
            hasExternalPrior,
            evidence: {
              scope: "commander",
              decksWith: Math.round(decksWith),
              commanderDeckCount: Math.round(commanderDeckCount),
              inclusionRate: round3(decksWith / commanderDeckCount),
              synergy: round3(inclusion - baseline),
              limited: isLimited(commanderDeckCount, baselineDeckCount, hasExternalPrior),
              ...(pooled ? { pooled: true } : {}),
            },
          },
        ];
      }
      // No decks of ours could have run the card. With an external rate for this commander that is still a
      // commander-specific answer, which is the case the prior exists for; `externalPriorShare` decides how much of the
      // commander-specific weight it earns.
      if (hasExternalPrior) {
        return [
          id,
          {
            baseline,
            baselineDeckCount,
            commanderDeckCount: 0,
            commanderRate: { inclusion: external, synergy: external - baseline },
            hasExternalPrior,
            evidence: {
              // Still 'colors': the contract's two scopes mean "counted over the commander's decks" and "over every
              // deck the colours allow", and this is neither - we counted nothing. Saying 'commander' would claim
              // decksWith and commanderDeckCount are ours. A third scope is a contract change, so it waits for the
              // slice that displays any of this and credits EDHREC.
              scope: "colors",
              decksWith: g?.decks_with ?? 0,
              commanderDeckCount: baselineDeckCount,
              inclusionRate: round3(baseline),
              synergy: 0,
              limited: false,
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
          hasExternalPrior: false,
          evidence: {
            scope: "colors",
            decksWith: g?.decks_with ?? 0,
            commanderDeckCount: baselineDeckCount,
            inclusionRate: round3(baseline),
            synergy: 0,
            limited: isLimited(0, baselineDeckCount, false),
          },
        },
      ];
    }),
  );
}
