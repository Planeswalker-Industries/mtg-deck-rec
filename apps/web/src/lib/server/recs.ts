import { fitsIdentity, gameChangerLimit } from "@mtg/core/commander";
import type {
  AddResult,
  AddSuggestion,
  CardCategory,
  CardId,
  CardSummary,
  CommanderKeyId,
  CostDelta,
  CutResult,
  CutSuggestion,
  RecContext,
  RecMode,
  SwapResult,
  SwapSuggestion,
  TagId,
  TagMatch,
  TagRef,
} from "@mtg/core/contract";
import {
  ADD_WEIGHTS,
  BASELINE_CORPUS_WEIGHT,
  blendScore,
  cardCategory,
  commanderCorpusScore,
  commanderShare,
  corpusComponent,
  manaValueProximity,
  neutralCorpusValue,
  roleGap,
  roleShortfalls,
  scoreCuts,
  SWAP_WEIGHTS,
  TAG_SIMILARITY_FLOOR,
  type RoleTarget,
  ownedFirst,
  ownedOnly,
  rankKey,
} from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary, type CardRow } from "./cards";
import { commanderKeyCounts, loadCardCorpus, loadCommanderCorpus, type CardCorpus, type CommanderCorpus } from "./corpus";
import type { PublicClient } from "./supabase";
import { isStatementTimeout, recordRecTimeout, retryOnTimeout } from "./retry-timeout";
import { cachedConfig } from "./config-cache";
import { loadServedAdds, loadServedCuts, loadServedSwapPool, loadServingReads } from "./serving";

/** How many tag-similar candidates the database returns before blending and trimming. */
const CANDIDATE_POOL = 120;
/** A pool shared across decks can't leave out any one deck's cards up front, so it holds more candidates. */
export const SHARED_SWAP_POOL = CANDIDATE_POOL + 100;
/** How many widely played candidates the database returns before scoring and grouping cards to add. */
const ADD_POOL = 400;
export const MAX_SWAP_LIMIT = 20;
export const MAX_CUT_LIMIT = 40;
export const MAX_ADD_PER_CATEGORY = 30;

/** Card-to-add groups in display order. */
const ADD_CATEGORIES: readonly CardCategory[] = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "battle", "land"];

export class NotFoundError extends Error {}

export interface RawMatch {
  targetTagId: string;
  candidateTagId: string;
  viaTagId: string | null;
  distance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const frontType = (typeLine: string) => typeLine.split(" // ")[0] ?? typeLine;
const modeOf = (ctx: RecContext): RecMode => (ctx.ownership ? "collection_aware" : "collection_less");
/** Every card the collection holds, for badges and cost: in 'first' mode as much as in 'only'. */
const ownedIds = (ctx: RecContext): ReadonlySet<number> | null =>
  ctx.ownership?.kind === "session" ? new Set<number>(ctx.ownership.ownedCardIds) : null;
/** The cards suggestions are limited to: the collection in 'only' mode, nothing in 'first' mode. */
const onlyIds = (ctx: RecContext): ReadonlySet<number> | null => (ownedOnly(ctx) ? ownedIds(ctx) : null);

/** Used when app_config has no ownership row. The value lives in the database: the repo is public. */
const DEFAULT_OWNED_BOOST = 0;

/**
 * How far an owned card moves up in 'first' mode (app_config.ownership.firstBoost). Read only when that mode is on;
 * without the row, owned cards simply keep their place.
 */
export async function loadOwnedBoost(db: PublicClient, context: RecContext): Promise<number> {
  if (!ownedFirst(context)) return 0;
  return cachedConfig("ownership", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "ownership" });
    if (error) throw new Error(`Loading collection settings failed: ${error.message}`);
    const boost = (data as { firstBoost?: unknown } | null)?.firstBoost;
    return typeof boost === "number" && Number.isFinite(boost) ? boost : DEFAULT_OWNED_BOOST;
  });
}
const identityMaskOf = (ctx: RecContext, rows: ReadonlyMap<number, CardRow>) =>
  ctx.deck.commanders.reduce((mask, id) => mask | (rows.get(id)?.color_identity ?? 0), 0);
const mainDeckIds = (ctx: RecContext) => [...new Set(ctx.deck.cards.filter((c) => c.section === "main").map((c) => c.cardId))];

function costDelta(target: CardSummary, replacement: CardSummary, owned: ReadonlySet<number> | null): CostDelta {
  const targetUsd = target.price?.usd;
  const replacementUsd = replacement.price?.usd;
  const asOf = replacement.price?.asOf ?? target.price?.asOf ?? null;
  if (owned?.has(replacement.id) && owned.has(target.id)) return { usd: 0, basis: "both_owned", asOf };
  if (owned?.has(replacement.id)) {
    return targetUsd === undefined
      ? { usd: null, basis: "price_unavailable", asOf: null }
      : { usd: -targetUsd, basis: "owned_replacement", asOf };
  }
  if (targetUsd === undefined || replacementUsd === undefined) return { usd: null, basis: "price_unavailable", asOf: null };
  return { usd: round2(replacementUsd - targetUsd), basis: "buy_replacement_vs_buy_target", asOf };
}

export async function fetchTags(db: PublicClient, ids: readonly string[]): Promise<Map<string, TagRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("tags").select("id, slug, label").in("id", unique);
  if (error) throw new Error(`Loading tags failed: ${error.message}`);
  return new Map(data.map((t) => [t.id, { id: t.id as TagId, slug: t.slug, label: t.label }]));
}

function parseRoleTargets(value: unknown): RoleTarget[] {
  const roles = (value as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.flatMap((r): RoleTarget[] => {
    const { tagId, label, target } = (r ?? {}) as Record<string, unknown>;
    return typeof tagId === "string" && typeof label === "string" && typeof target === "number"
      ? [{ roleId: tagId, label, target }]
      : [];
  });
}

/**
 * Role targets for this deck: the generic targets, moved toward how many cards the commander's decks actually run in
 * each role as those decks gain weight. Liesa decks, for one, run far more removal than a generic deck.
 */
function roleTargetsFor(generic: readonly RoleTarget[], corpus: CommanderCorpus): RoleTarget[] {
  const share = commanderShare(corpus.effectiveDeckCount, corpus.settings);
  if (share === 0) return [...generic];
  return generic.map((t) => {
    const typical = corpus.roleProfile[t.roleId];
    return typical === undefined ? t : { ...t, target: Math.round((share * typical + (1 - share) * t.target) * 10) / 10 };
  });
}

export function loadRoleTargets(db: PublicClient): Promise<RoleTarget[]> {
  return cachedConfig("deck_role_targets", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "deck_role_targets" });
    if (error) throw new Error(`Loading role targets failed: ${error.message}`);
    return parseRoleTargets(data);
  });
}

/** The tracked roles' tags, for naming the roles a card fills. */
export function loadRoleTags(db: PublicClient): Promise<Map<string, TagRef>> {
  return cachedConfig("role_tags", async () =>
    fetchTags(
      db,
      (await loadRoleTargets(db)).map((t) => t.roleId),
    ),
  );
}

/** Which tracked roles (ramp, removal, ...) each card fills: rec_card_roles, the path before the serving tables. */
async function loadCardRoles(db: PublicClient, cardIds: readonly number[], roleTargets: readonly RoleTarget[]): Promise<Map<number, string[]>> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0 || roleTargets.length === 0) return new Map();
  const { data, error } = await db.rpc("rec_card_roles", { p_card_ids: ids, p_role_ids: roleTargets.map((r) => r.roleId) });
  if (error) throw new Error(`Loading card roles failed: ${error.message}`);
  const rolesByCard = new Map<number, string[]>();
  for (const { card_id, role_id } of data ?? []) rolesByCard.set(card_id, [...(rolesByCard.get(card_id) ?? []), role_id]);
  return rolesByCard;
}

export interface SwapPoolCandidate {
  cardId: number;
  row: CardRow;
  tagSimilarity: number;
  stapleScore: number;
  functionalTwin: boolean;
  matchedTags: TagMatch[];
  rates: CardCorpus | null;
}

/** Everything a swap needs that doesn't depend on the rest of the deck, so it can be shared across decks and cached. */
export interface SwapPool {
  target: CardRow;
  tagCount: number;
  corpus: CommanderCorpus;
  candidates: SwapPoolCandidate[];
}

/** Loads replacement candidates for a card under a commander (or pair). Null when the card isn't in the catalog. */
export async function loadSwapPool(
  db: PublicClient,
  {
    targetCardId,
    commanderIds,
    includeGameChangers,
    excludeIds,
    ownedIds: owned,
    poolSize,
    identityMask: identityOverride,
  }: {
    targetCardId: number;
    commanderIds: readonly number[];
    includeGameChangers: boolean;
    excludeIds: readonly number[];
    ownedIds: readonly number[] | null;
    poolSize: number;
    /** Colors candidates must fit. Defaults to the commanders' combined identity. */
    identityMask?: number | undefined;
  },
): Promise<SwapPool | null> {
  if (await loadServingReads(db)) {
    return loadServedSwapPool(db, { targetCardId, commanderIds, includeGameChangers, excludeIds, ownedIds: owned, poolSize, identityMask: identityOverride });
  }
  const rows = await fetchCardsById(db, [...commanderIds, targetCardId]);
  const targetRow = rows.get(targetCardId);
  if (!targetRow) return null;
  const identityMask = identityOverride ?? commanderIds.reduce((mask, id) => mask | (rows.get(id)?.color_identity ?? 0), 0);

  const candidateArgs = {
    p_target: targetCardId,
    p_exclude: [...excludeIds],
    p_identity_mask: identityMask,
    p_allow_game_changers: includeGameChangers,
    p_owned: owned ? [...owned] : undefined,
    p_limit: poolSize,
  };
  const [candidatesResult, tagCountResult, corpus] = await Promise.all([
    retryOnTimeout("Swap candidates", () => db.rpc("rec_swap_candidates", candidateArgs)),
    db.rpc("rec_functional_tag_count", { p_card_id: targetCardId }),
    loadCommanderCorpus(db, commanderIds),
  ]);
  if (candidatesResult.error) {
    if (isStatementTimeout(candidatesResult.error)) {
      recordRecTimeout(db, { fn: "swap", targetCardId, commanderIds, identityMask, ownedOnly: owned !== null });
    }
    throw new Error(`Swap candidates failed: ${candidatesResult.error.message}`);
  }
  if (tagCountResult.error) throw new Error(`Tag count failed: ${tagCountResult.error.message}`);

  const raw = (candidatesResult.data ?? []).map((r) => ({ ...r, matches: r.matches as unknown as RawMatch[] }));
  const ids = raw.map((c) => c.card_id);
  const [candidateRows, tags, cardCorpus] = await Promise.all([
    fetchCardsById(db, ids),
    fetchTags(
      db,
      raw.flatMap((c) => c.matches.flatMap((m) => [m.targetTagId, m.candidateTagId, ...(m.viaTagId ? [m.viaTagId] : [])])),
    ),
    loadCardCorpus(db, corpus, ids, commanderIds),
  ]);

  return {
    target: targetRow,
    tagCount: tagCountResult.data ?? 0,
    corpus,
    candidates: raw.flatMap((c): SwapPoolCandidate[] => {
      const row = candidateRows.get(c.card_id);
      if (!row) return [];
      const matchedTags = c.matches.flatMap((m): TagMatch[] => {
        const targetTag = tags.get(m.targetTagId);
        const candidateTag = tags.get(m.candidateTagId);
        if (!targetTag || !candidateTag) return [];
        return [{ targetTag, candidateTag, via: m.viaTagId ? (tags.get(m.viaTagId) ?? null) : null, distance: m.distance }];
      });
      return [
        {
          cardId: c.card_id,
          row,
          tagSimilarity: c.tag_similarity,
          stapleScore: c.staple_score,
          functionalTwin: c.is_functional_twin,
          matchedTags,
          rates: cardCorpus.get(c.card_id) ?? null,
        },
      ];
    }),
  };
}

/**
 * Ranks a swap pool for one deck: leaves out the deck's own cards (and unowned cards in 'only' mode), then blends
 * scores. In 'first' mode owned cards move up by `ownedBoost` (see loadOwnedBoost).
 */
export function rankSwaps(
  pool: SwapPool,
  { context, limit = 10, ownedBoost = 0 }: { context: RecContext; limit?: number; ownedBoost?: number },
): SwapResult {
  const owned = ownedIds(context);
  const only = onlyIds(context);
  const mode = modeOf(context);
  const target = toCardSummary(pool.target);
  const inDeck = new Set<number>([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)]);
  const candidates = pool.candidates.filter(
    (c) => !inDeck.has(c.cardId) && (!only || only.has(c.cardId)) && c.tagSimilarity >= TAG_SIMILARITY_FLOOR,
  );

  // undefined: no corpus loaded at all. null: too new to judge by play rates.
  const corpusScores = new Map(
    candidates.map((c) => {
      const score = c.rates
        ? corpusComponent(
            {
              commanderRate: c.rates.commanderRate,
              commanderDeckCount: c.rates.commanderDeckCount,
              baseline: c.rates.baseline,
              baselineDeckCount: c.rates.baselineDeckCount,
              hasExternalPrior: c.rates.hasExternalPrior,
            },
            pool.corpus.settings,
          )
        : undefined;
      return [c.cardId, score] as const;
    }),
  );
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue([...corpusScores.values()].flatMap((s) => (s ? [s.value] : [])));
  // The collection-aware weights are for choosing among owned cards alone. 'first' ranks every card, so it keeps the
  // everyday weights and differs from a collection-less ranking only by the owned boost.
  const baseWeights = SWAP_WEIGHTS[only ? "collection_aware" : "collection_less"];

  const suggestions = candidates
    .map((c): SwapSuggestion => {
      const card = toCardSummary(c.row);
      const known = corpusScores.get(c.cardId);
      const corpusScore = known === null ? { value: neutralCorpus, weightScale: BASELINE_CORPUS_WEIGHT } : (known ?? null);
      return {
        card,
        functionalTwin: c.functionalTwin,
        matchedTags: c.matchedTags,
        corpus: c.rates?.evidence ?? null,
        votes: { score: 0.5, voteCount: 0, myVote: null },
        costDelta: costDelta(target, card, owned),
        owned: owned?.has(card.id) ? { quantity: 1 } : null,
        score: blendScore(
          {
            tag: round2(c.tagSimilarity),
            manaValue: round2(manaValueProximity(card.manaValue, target.manaValue)),
            staple: round2(c.stapleScore),
            corpus: corpusScore ? round2(corpusScore.value) : null,
            votes: null,
            role: null,
          },
          corpusScore ? { ...baseWeights, corpus: baseWeights.corpus * corpusScore.weightScale } : baseWeights,
        ),
      };
    })
    .sort((a, b) => rankKey(b.score.total, b.owned !== null, ownedBoost) - rankKey(a.score.total, a.owned !== null, ownedBoost))
    .slice(0, limit);

  const result: SwapResult = { mode, target, confidence: pool.corpus.confidence, suggestions };
  if (suggestions.length === 0) {
    result.emptyReason = pool.tagCount === 0 ? "NO_TAGS_ON_TARGET" : only ? "NOTHING_OWNED_FITS" : "NO_CANDIDATES";
  }
  return result;
}

/** Replacements for one card, computed for this deck alone. The swap route caches through getCachedSwapSuggestions instead. */
export async function getSwapSuggestions(
  db: PublicClient,
  { context, targetCardId, limit = 10 }: { context: RecContext; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  const only = onlyIds(context);
  const [pool, ownedBoost] = await Promise.all([
    loadSwapPool(db, {
      targetCardId,
      commanderIds: context.deck.commanders,
      includeGameChangers: context.includeGameChangers,
      excludeIds: [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])],
      ownedIds: only ? [...only] : null,
      poolSize: CANDIDATE_POOL,
    }),
    loadOwnedBoost(db, context),
  ]);
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  return rankSwaps(pool, { context, limit, ownedBoost });
}

/** What cut suggestions read: the deck's card rows, their play rates and roles, and the commander's corpus. */
interface CutInputs {
  rows: ReadonlyMap<number, CardRow>;
  corpus: CommanderCorpus;
  cardCorpus: ReadonlyMap<number, CardCorpus>;
  rolesByCard: ReadonlyMap<number, readonly string[]>;
}

/** The cut inputs before the serving tables (T055): the rows and corpus, then play rates and roles. */
async function loadCutInputs(db: PublicClient, context: RecContext, mainIds: readonly number[], roleTargets: readonly RoleTarget[]): Promise<CutInputs> {
  const [rows, corpus] = await Promise.all([
    fetchCardsById(db, [...mainIds, ...context.deck.commanders]),
    loadCommanderCorpus(db, context.deck.commanders),
  ]);
  const [rolesByCard, cardCorpus] = await Promise.all([
    loadCardRoles(db, mainIds, roleTargets),
    loadCardCorpus(db, corpus, mainIds, context.deck.commanders),
  ]);
  return { rows, corpus, cardCorpus, rolesByCard };
}

export async function getCutSuggestions(
  db: PublicClient,
  { context, limit = 20 }: { context: RecContext; limit?: number },
): Promise<CutResult> {
  const mainIds = mainDeckIds(context);
  const [serving, roleTargets] = await Promise.all([loadServingReads(db), loadRoleTargets(db)]);
  const { rows, corpus, cardCorpus, rolesByCard }: CutInputs = serving
    ? await loadServedCuts(db, { commanderIds: context.deck.commanders, mainIds }).then((c) => ({
        rows: c.rows,
        corpus: c.corpus,
        cardCorpus: c.rates,
        rolesByCard: c.roles,
      }))
    : await loadCutInputs(db, context, mainIds, roleTargets);

  // Play rates judge a cut only once enough of the commander's decks could have run the card (updated since its
  // release); broad popularity says little about fit, and new cards aren't judged by older decks.
  const commanderRateFor = (id: number) => {
    const rates = cardCorpus.get(id);
    return rates?.commanderRate && commanderShare(rates.commanderDeckCount, corpus.settings) > 0 ? rates : null;
  };
  const identityMask = identityMaskOf(context, rows);
  const scored = scoreCuts(
    mainIds.flatMap((id) => {
      const row = rows.get(id);
      if (!row) return [];
      const rate = commanderRateFor(id)?.commanderRate;
      return [
        {
          cardId: id,
          manaValue: row.mana_value,
          isLand: /\bLand\b/.test(frontType(row.type_line)),
          isCommanderLegal: row.legal_commander === "legal",
          withinIdentity: context.deck.commanders.length === 0 || fitsIdentity(row.color_identity, identityMask),
          gameChanger: row.game_changer,
          roleIds: [...(rolesByCard.get(id) ?? [])],
          // Basic lands aren't in the corpus stats, so they'd all look unplayed.
          corpusScore: rate && !row.is_basic_land ? commanderCorpusScore(rate) : null,
        },
      ];
    }),
    {
      includeGameChangers: context.includeGameChangers,
      gameChangerLimit: gameChangerLimit(context.bracket),
      roleTargets: roleTargetsFor(roleTargets, corpus),
      severeSynergyScore: corpus.settings.severeSynergyScore,
    },
  );

  const owned = ownedIds(context);
  const suggestions = scored.slice(0, limit).flatMap((s): CutSuggestion[] => {
    const row = rows.get(s.cardId);
    if (!row) return [];
    // Only 'only' mode flags unowned cards: in 'first' mode the collection is a preference, not a rule.
    const notOwned = owned !== null && ownedOnly(context) && !owned.has(s.cardId);
    return [
      {
        card: toCardSummary(row),
        cutScore: s.cutScore,
        reasons: notOwned ? [...s.reasons, "NOT_OWNED"] : s.reasons,
        severity: s.severity,
        corpus: commanderRateFor(s.cardId)?.evidence ?? null,
        owned: owned?.has(s.cardId) ? { quantity: 1 } : null,
      },
    ];
  });
  return { mode: modeOf(context), confidence: corpus.confidence, suggestions };
}

/** The add pool from rec_add_candidates, the path before the serving tables (T055). */
async function loadAddCandidates(
  db: PublicClient,
  context: RecContext,
  rows: ReadonlyMap<number, CardRow>,
  corpus: CommanderCorpus,
  useCommander: boolean,
  exclude: readonly number[],
  only: ReadonlySet<number> | null,
): Promise<{ card_id: number; baseline: number }[]> {
  const { data, error } = await retryOnTimeout("Add candidates", () =>
    db.rpc("rec_add_candidates", {
      p_key_ids: useCommander ? corpus.sourceKeyIds : [],
      p_key_weights: useCommander ? corpus.sources.map((s) => s.weight) : [],
      p_alpha: corpus.settings.shrinkAlpha,
      p_identity_mask: identityMaskOf(context, rows),
      p_exclude: [...exclude],
      p_allow_game_changers: context.includeGameChangers,
      p_owned: only ? [...only] : undefined,
      p_limit: ADD_POOL,
    }),
  );
  if (error) {
    if (isStatementTimeout(error)) {
      recordRecTimeout(db, {
        fn: "add",
        commanderIds: context.deck.commanders,
        identityMask: identityMaskOf(context, rows),
        ownedOnly: only !== null,
      });
    }
    throw new Error(`Add candidates failed: ${error.message}`);
  }
  return data ?? [];
}

/** What add suggestions read: the commander's rows and corpus, the pool and its cards, and the deck's roles. */
interface AddInputs {
  corpus: CommanderCorpus;
  commanderRows: ReadonlyMap<number, CardRow>;
  /** The pool's card ids, best first. */
  poolIds: readonly number[];
  /** rec_add_candidates' baseline per card, for a card whose play rates are missing (the old path only). */
  poolBaselines: ReadonlyMap<number, number>;
  candidateRows: ReadonlyMap<number, CardRow>;
  cardCorpus: ReadonlyMap<number, CardCorpus>;
  /** The deck's main cards and the pool's. */
  rolesByCard: ReadonlyMap<number, readonly string[]>;
}

/** The add inputs before the serving tables (T055): rows and corpus, then the pool, then its rows, rates and roles. */
async function loadAddInputs(
  db: PublicClient,
  context: RecContext,
  { deckIds, mainIds, exclude, only, roleTargets }: {
    deckIds: readonly number[];
    mainIds: readonly number[];
    exclude: readonly number[];
    only: ReadonlySet<number> | null;
    roleTargets: readonly RoleTarget[];
  },
): Promise<AddInputs> {
  const [rows, corpus] = await Promise.all([fetchCardsById(db, deckIds), loadCommanderCorpus(db, context.deck.commanders)]);
  if (!corpus.available) {
    return { corpus, commanderRows: rows, poolIds: [], poolBaselines: new Map(), candidateRows: new Map(), cardCorpus: new Map(), rolesByCard: new Map() };
  }
  const useCommander = commanderShare(corpus.effectiveDeckCount, corpus.settings) > 0;
  const pool = await loadAddCandidates(db, context, rows, corpus, useCommander, exclude, only);
  const candidateIds = pool.map((p) => p.card_id);
  const [candidateRows, cardCorpus, rolesByCard] = await Promise.all([
    fetchCardsById(db, candidateIds),
    loadCardCorpus(db, corpus, candidateIds, context.deck.commanders),
    loadCardRoles(db, [...mainIds, ...candidateIds], roleTargets),
  ]);
  return {
    corpus,
    commanderRows: rows,
    poolIds: candidateIds,
    poolBaselines: new Map(pool.map((p) => [p.card_id, p.baseline])),
    candidateRows,
    cardCorpus,
    rolesByCard,
  };
}

/**
 * Cards to add: what decks with this commander run that this deck doesn't, scored by play rate and by the roles the
 * deck is short on. Without enough commander decks, cards widely played in decks of these colors stand in.
 */
export async function getAddSuggestions(
  db: PublicClient,
  {
    context,
    limitPerCategory = 8,
    excludeCardIds = [],
  }: {
    context: RecContext;
    limitPerCategory?: number | undefined;
    /** Cards the player passed on: left out of the pool like the deck's own, but not read as part of the deck. */
    excludeCardIds?: readonly number[] | undefined;
  },
): Promise<AddResult> {
  const deckIds = [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])];
  const mainIds = mainDeckIds(context);
  const owned = ownedIds(context);
  const only = onlyIds(context);
  const mode = modeOf(context);
  const exclude = [...new Set([...deckIds, ...excludeCardIds])];

  const [serving, roleTargets, roleTags, ownedBoost] = await Promise.all([
    loadServingReads(db),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadOwnedBoost(db, context),
  ]);
  const inputs: AddInputs = serving
    ? await loadServedAdds(db, {
        commanderIds: context.deck.commanders,
        mainIds,
        exclude,
        allowGameChangers: context.includeGameChangers,
        owned: only ? [...only] : null,
        limit: ADD_POOL,
      }).then((a) => ({
        corpus: a.corpus,
        commanderRows: a.commanderRows,
        poolIds: a.poolIds,
        poolBaselines: new Map<number, number>(),
        candidateRows: a.pool.rows,
        cardCorpus: a.pool.rates,
        rolesByCard: new Map([...a.deckRoles, ...a.pool.roles]),
      }))
    : await loadAddInputs(db, context, { deckIds, mainIds, exclude, only, roleTargets });
  const { corpus, commanderRows, poolIds, poolBaselines, candidateRows, cardCorpus, rolesByCard } = inputs;

  const commanderKey: AddResult["commanderKey"] = {
    id: corpus.keyId as CommanderKeyId | null,
    slug: corpus.slug,
    commanders: context.deck.commanders.flatMap((id) => {
      const row = commanderRows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    ...commanderKeyCounts(corpus),
  };
  if (!corpus.available) return { mode, commanderKey, confidence: "none", groups: [] };

  const deckRoleCounts = new Map<string, number>();
  for (const id of mainIds) for (const role of rolesByCard.get(id) ?? []) deckRoleCounts.set(role, (deckRoleCounts.get(role) ?? 0) + 1);
  const shortfalls = roleShortfalls(deckRoleCounts, roleTargetsFor(roleTargets, corpus));
  const roleLabels = new Map(roleTargets.map((t) => [t.roleId, t.label]));

  const scoredPool = poolIds.map((cardId) => {
    const rates = cardCorpus.get(cardId);
    const corpusScore = corpusComponent(
      {
        commanderRate: rates?.commanderRate ?? null,
        commanderDeckCount: rates?.commanderDeckCount ?? 0,
        baseline: rates?.baseline ?? poolBaselines.get(cardId) ?? 0,
        baselineDeckCount: rates?.baselineDeckCount ?? 0,
        hasExternalPrior: rates?.hasExternalPrior ?? false,
      },
      corpus.settings,
    );
    return { cardId, rates, corpusScore };
  });
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue(scoredPool.flatMap((p) => (p.corpusScore ? [p.corpusScore.value] : [])));

  const suggestions = scoredPool.flatMap(({ cardId, rates, corpusScore }): AddSuggestion[] => {
    const row = candidateRows.get(cardId);
    if (!row) return [];
    const card = toCardSummary(row);
    const { gap, roleIds } = roleGap([...(rolesByCard.get(cardId) ?? [])], shortfalls);
    return [
      {
        card,
        category: cardCategory(row.type_line),
        score: blendScore(
          { tag: null, manaValue: null, staple: null, corpus: round2(corpusScore?.value ?? neutralCorpus), votes: null, role: round2(gap) },
          ADD_WEIGHTS,
        ),
        corpus: rates?.evidence ?? null,
        fillsRoles: roleIds.flatMap((id): TagRef[] => {
          const tag = roleTags.get(id);
          return tag ? [{ ...tag, label: roleLabels.get(id) ?? tag.label }] : [];
        }),
        owned: owned?.has(card.id) ? { quantity: 1 } : null,
      },
    ];
  });

  const groups = ADD_CATEGORIES.map((category) => ({
    category,
    suggestions: suggestions
      .filter((s) => s.category === category)
      .sort((a, b) => rankKey(b.score.total, b.owned !== null, ownedBoost) - rankKey(a.score.total, a.owned !== null, ownedBoost))
      .slice(0, limitPerCategory),
  })).filter((g) => g.suggestions.length > 0);

  return { mode, commanderKey, confidence: corpus.confidence, groups };
}

export type { CardId };
