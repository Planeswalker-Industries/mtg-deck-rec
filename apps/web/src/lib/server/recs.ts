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
} from "@mtg/core/scoring";
import { fetchCardsById, toCardSummary, type CardRow } from "./cards";
import { commanderKeyCounts, loadCardCorpus, loadCommanderCorpus, type CardCorpus, type CommanderCorpus } from "./corpus";
import type { PublicClient } from "./supabase";

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

interface RawMatch {
  targetTagId: string;
  candidateTagId: string;
  viaTagId: string | null;
  distance: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const frontType = (typeLine: string) => typeLine.split(" // ")[0] ?? typeLine;
const modeOf = (ctx: RecContext): RecMode => (ctx.ownership ? "collection_aware" : "collection_less");
const ownedIds = (ctx: RecContext): ReadonlySet<number> | null =>
  ctx.ownership?.kind === "session" ? new Set<number>(ctx.ownership.ownedCardIds) : null;
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

export async function loadRoleTargets(db: PublicClient): Promise<RoleTarget[]> {
  const { data, error } = await db.rpc("get_public_config", { p_key: "deck_role_targets" });
  if (error) throw new Error(`Loading role targets failed: ${error.message}`);
  return parseRoleTargets(data);
}

/** Which tracked roles (ramp, removal, ...) each card fills. */
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
  const rows = await fetchCardsById(db, [...commanderIds, targetCardId]);
  const targetRow = rows.get(targetCardId);
  if (!targetRow) return null;
  const identityMask = identityOverride ?? commanderIds.reduce((mask, id) => mask | (rows.get(id)?.color_identity ?? 0), 0);

  const [candidatesResult, tagCountResult, corpus] = await Promise.all([
    db.rpc("rec_swap_candidates", {
      p_target: targetCardId,
      p_exclude: [...excludeIds],
      p_identity_mask: identityMask,
      p_allow_game_changers: includeGameChangers,
      p_owned: owned ? [...owned] : undefined,
      p_limit: poolSize,
    }),
    db.rpc("rec_functional_tag_count", { p_card_id: targetCardId }),
    loadCommanderCorpus(db, commanderIds),
  ]);
  if (candidatesResult.error) throw new Error(`Swap candidates failed: ${candidatesResult.error.message}`);
  if (tagCountResult.error) throw new Error(`Tag count failed: ${tagCountResult.error.message}`);

  const raw = (candidatesResult.data ?? []).map((r) => ({ ...r, matches: r.matches as unknown as RawMatch[] }));
  const ids = raw.map((c) => c.card_id);
  const [candidateRows, tags, cardCorpus] = await Promise.all([
    fetchCardsById(db, ids),
    fetchTags(
      db,
      raw.flatMap((c) => c.matches.flatMap((m) => [m.targetTagId, m.candidateTagId, ...(m.viaTagId ? [m.viaTagId] : [])])),
    ),
    loadCardCorpus(db, corpus, ids),
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

/** Ranks a swap pool for one deck: leaves out the deck's own cards (and unowned cards in collection mode), then blends scores. */
export function rankSwaps(pool: SwapPool, { context, limit = 10 }: { context: RecContext; limit?: number }): SwapResult {
  const owned = ownedIds(context);
  const mode = modeOf(context);
  const target = toCardSummary(pool.target);
  const inDeck = new Set<number>([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)]);
  const candidates = pool.candidates.filter(
    (c) => !inDeck.has(c.cardId) && (!owned || owned.has(c.cardId)) && c.tagSimilarity >= TAG_SIMILARITY_FLOOR,
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
            },
            pool.corpus.settings,
          )
        : undefined;
      return [c.cardId, score] as const;
    }),
  );
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue([...corpusScores.values()].flatMap((s) => (s ? [s.value] : [])));
  const baseWeights = SWAP_WEIGHTS[mode];

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
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);

  const result: SwapResult = { mode, target, confidence: pool.corpus.confidence, suggestions };
  if (suggestions.length === 0) {
    result.emptyReason = pool.tagCount === 0 ? "NO_TAGS_ON_TARGET" : owned ? "NOTHING_OWNED_FITS" : "NO_CANDIDATES";
  }
  return result;
}

/** Replacements for one card, computed for this deck alone. The swap route caches through getCachedSwapSuggestions instead. */
export async function getSwapSuggestions(
  db: PublicClient,
  { context, targetCardId, limit = 10 }: { context: RecContext; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  const owned = ownedIds(context);
  const pool = await loadSwapPool(db, {
    targetCardId,
    commanderIds: context.deck.commanders,
    includeGameChangers: context.includeGameChangers,
    excludeIds: [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])],
    ownedIds: owned ? [...owned] : null,
    poolSize: CANDIDATE_POOL,
  });
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  return rankSwaps(pool, { context, limit });
}

export async function getCutSuggestions(
  db: PublicClient,
  { context, limit = 20 }: { context: RecContext; limit?: number },
): Promise<CutResult> {
  const mainIds = mainDeckIds(context);
  const [rows, roleTargets, corpus] = await Promise.all([
    fetchCardsById(db, [...mainIds, ...context.deck.commanders]),
    loadRoleTargets(db),
    loadCommanderCorpus(db, context.deck.commanders),
  ]);
  const [rolesByCard, cardCorpus] = await Promise.all([loadCardRoles(db, mainIds, roleTargets), loadCardCorpus(db, corpus, mainIds)]);

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
          roleIds: rolesByCard.get(id) ?? [],
          // Basic lands aren't in the corpus stats, so they'd all look unplayed.
          corpusScore: rate && !row.is_basic_land ? commanderCorpusScore(rate) : null,
        },
      ];
    }),
    {
      includeGameChangers: context.includeGameChangers,
      gameChangerLimit: gameChangerLimit(context.bracket),
      roleTargets: roleTargetsFor(roleTargets, corpus),
    },
  );

  const owned = ownedIds(context);
  const suggestions = scored.slice(0, limit).flatMap((s): CutSuggestion[] => {
    const row = rows.get(s.cardId);
    if (!row) return [];
    const notOwned = owned !== null && !owned.has(s.cardId);
    return [
      {
        card: toCardSummary(row),
        cutScore: s.cutScore,
        reasons: notOwned ? [...s.reasons, "NOT_OWNED"] : s.reasons,
        corpus: commanderRateFor(s.cardId)?.evidence ?? null,
        owned: owned?.has(s.cardId) ? { quantity: 1 } : null,
      },
    ];
  });
  return { mode: modeOf(context), confidence: corpus.confidence, suggestions };
}

/**
 * Cards to add: what decks with this commander run that this deck doesn't, scored by play rate and by the roles the
 * deck is short on. Without enough commander decks, cards widely played in decks of these colors stand in.
 */
export async function getAddSuggestions(
  db: PublicClient,
  { context, limitPerCategory = 8 }: { context: RecContext; limitPerCategory?: number },
): Promise<AddResult> {
  const deckIds = [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])];
  const mainIds = mainDeckIds(context);
  const owned = ownedIds(context);
  const mode = modeOf(context);

  const [rows, corpus, roleTargets] = await Promise.all([
    fetchCardsById(db, deckIds),
    loadCommanderCorpus(db, context.deck.commanders),
    loadRoleTargets(db),
  ]);
  const commanderKey: AddResult["commanderKey"] = {
    id: corpus.keyId as CommanderKeyId | null,
    slug: corpus.slug,
    commanders: context.deck.commanders.flatMap((id) => {
      const row = rows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    ...commanderKeyCounts(corpus),
  };
  if (!corpus.available) return { mode, commanderKey, confidence: "none", groups: [] };

  const useCommander = commanderShare(corpus.effectiveDeckCount, corpus.settings) > 0;
  const { data: pool, error } = await db.rpc("rec_add_candidates", {
    p_key_ids: useCommander ? corpus.sourceKeyIds : [],
    p_key_weights: useCommander ? corpus.sources.map((s) => s.weight) : [],
    p_alpha: corpus.settings.shrinkAlpha,
    p_identity_mask: identityMaskOf(context, rows),
    p_exclude: deckIds,
    p_allow_game_changers: context.includeGameChangers,
    p_owned: owned ? [...owned] : undefined,
    p_limit: ADD_POOL,
  });
  if (error) throw new Error(`Add candidates failed: ${error.message}`);

  const candidateIds = (pool ?? []).map((p) => p.card_id);
  const [candidateRows, cardCorpus, rolesByCard, roleTags] = await Promise.all([
    fetchCardsById(db, candidateIds),
    loadCardCorpus(db, corpus, candidateIds),
    loadCardRoles(db, [...mainIds, ...candidateIds], roleTargets),
    fetchTags(
      db,
      roleTargets.map((t) => t.roleId),
    ),
  ]);

  const deckRoleCounts = new Map<string, number>();
  for (const id of mainIds) for (const role of rolesByCard.get(id) ?? []) deckRoleCounts.set(role, (deckRoleCounts.get(role) ?? 0) + 1);
  const shortfalls = roleShortfalls(deckRoleCounts, roleTargetsFor(roleTargets, corpus));
  const roleLabels = new Map(roleTargets.map((t) => [t.roleId, t.label]));

  const scoredPool = (pool ?? []).map((candidate) => {
    const rates = cardCorpus.get(candidate.card_id);
    const corpusScore = corpusComponent(
      {
        commanderRate: rates?.commanderRate ?? null,
        commanderDeckCount: rates?.commanderDeckCount ?? 0,
        baseline: rates?.baseline ?? candidate.baseline,
        baselineDeckCount: rates?.baselineDeckCount ?? 0,
      },
      corpus.settings,
    );
    return { candidate, rates, corpusScore };
  });
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue(scoredPool.flatMap((p) => (p.corpusScore ? [p.corpusScore.value] : [])));

  const suggestions = scoredPool.flatMap(({ candidate, rates, corpusScore }): AddSuggestion[] => {
    const row = candidateRows.get(candidate.card_id);
    if (!row) return [];
    const card = toCardSummary(row);
    const { gap, roleIds } = roleGap(rolesByCard.get(candidate.card_id) ?? [], shortfalls);
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
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, limitPerCategory),
  })).filter((g) => g.suggestions.length > 0);

  return { mode, commanderKey, confidence: corpus.confidence, groups };
}

export type { CardId };
