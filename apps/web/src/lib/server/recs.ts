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
import { toCardSummary, type CardRow } from "./cards";
import { commanderKeyCounts, type CardCorpus, type CommanderCorpus } from "./corpus";
import type { PublicClient } from "./supabase";
import { cachedConfig } from "./config-cache";
import { loadServedAdds, loadServedCuts, loadServedSwapPool } from "./serving";

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
export function loadSwapPool(
  db: PublicClient,
  input: {
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
  return loadServedSwapPool(db, input);
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

export async function getCutSuggestions(
  db: PublicClient,
  { context, limit = 20 }: { context: RecContext; limit?: number },
): Promise<CutResult> {
  const mainIds = mainDeckIds(context);
  const [served, roleTargets] = await Promise.all([
    loadServedCuts(db, { commanderIds: context.deck.commanders, mainIds }),
    loadRoleTargets(db),
  ]);
  const { rows, corpus, cardCorpus, rolesByCard }: CutInputs = {
    rows: served.rows,
    corpus: served.corpus,
    cardCorpus: served.rates,
    rolesByCard: served.roles,
  };

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

/** What add suggestions read: the commander's rows and corpus, the pool and its cards, and the deck's roles. */
interface AddInputs {
  corpus: CommanderCorpus;
  commanderRows: ReadonlyMap<number, CardRow>;
  /** The pool's card ids, best first. */
  poolIds: readonly number[];
  candidateRows: ReadonlyMap<number, CardRow>;
  cardCorpus: ReadonlyMap<number, CardCorpus>;
  /** The deck's main cards and the pool's. */
  rolesByCard: ReadonlyMap<number, readonly string[]>;
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

  const [served, roleTargets, roleTags, ownedBoost] = await Promise.all([
    loadServedAdds(db, {
      commanderIds: context.deck.commanders,
      mainIds,
      exclude,
      allowGameChangers: context.includeGameChangers,
      owned: only ? [...only] : null,
      limit: ADD_POOL,
    }),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadOwnedBoost(db, context),
  ]);
  const { corpus, commanderRows, poolIds, candidateRows, cardCorpus, rolesByCard }: AddInputs = {
    corpus: served.corpus,
    commanderRows: served.commanderRows,
    poolIds: served.poolIds,
    candidateRows: served.pool.rows,
    cardCorpus: served.pool.rates,
    rolesByCard: new Map([...served.deckRoles, ...served.pool.roles]),
  };

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
        baseline: rates?.baseline ?? 0,
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
