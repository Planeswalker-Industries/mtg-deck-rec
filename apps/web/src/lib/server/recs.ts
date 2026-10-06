import type { AddResult, CommanderKeyId, CutResult, RecContext, SwapResult, TagId, TagRef } from "@mtg/core/contract";
import {
  mainDeckIds,
  modeOf,
  onlyIds,
  ownedFirst,
  rankAdds,
  rankCuts,
  rankSwaps,
  type RankCard,
  type RoleTarget,
  type SwapPool,
} from "@mtg/core/scoring";
import { rankCardOf, toCardSummary, type CardRow } from "./cards";
import { cachedConfig } from "./config-cache";
import { commanderKeyCounts } from "./corpus";
import { loadScoringConfig } from "./scoring-config";
import { loadServedAdds, loadServedCuts, loadServedSwapPool } from "./serving";
import type { PublicClient } from "./supabase";

/**
 * Add, cut and swap suggestions: every read goes out at once (serving.ts), then `@mtg/core/scoring` ranks the rows with
 * the weights in `app_config.scoring`. Keep `next/cache` out of this file, so scripts can run it outside Next.js.
 */

/** How many tag-similar candidates the database returns before blending and trimming. */
const CANDIDATE_POOL = 120;
/** A pool shared across decks can't leave out any one deck's cards up front, so it holds more candidates. */
export const SHARED_SWAP_POOL = CANDIDATE_POOL + 100;
/** How many widely played candidates the database returns before scoring and grouping cards to add. */
const ADD_POOL = 400;
export const MAX_SWAP_LIMIT = 20;
/** Replacements shown when a request names no limit. */
export const DEFAULT_SWAP_LIMIT = 10;
export const MAX_CUT_LIMIT = 40;
export const MAX_ADD_PER_CATEGORY = 30;

export class NotFoundError extends Error {}

/**
 * How far an owned card moves up in 'first' mode (`app_config.ownership.firstBoost`, required). Read only when that
 * mode is on; otherwise nothing moves.
 */
export async function loadOwnedBoost(db: PublicClient, context: RecContext): Promise<number> {
  if (!ownedFirst(context)) return 0;
  return cachedConfig("ownership", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "ownership" });
    if (error) throw new Error(`Loading collection settings failed: ${error.message}`);
    const boost = (data as { firstBoost?: unknown } | null)?.firstBoost;
    if (typeof boost !== "number" || !Number.isFinite(boost)) throw new Error("app_config.ownership.firstBoost is missing or malformed");
    return boost;
  });
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

const rankCards = (rows: ReadonlyMap<number, CardRow>): Map<number, RankCard> => new Map([...rows].map(([id, row]) => [id, rankCardOf(row)]));

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

/** Replacements for one card, computed for this deck alone. The swap route caches through getCachedSwapSuggestions instead. */
export async function getSwapSuggestions(
  db: PublicClient,
  { context, targetCardId, limit = DEFAULT_SWAP_LIMIT }: { context: RecContext; targetCardId: number; limit?: number },
): Promise<SwapResult> {
  const only = onlyIds(context);
  const [pool, ownedBoost, scoring] = await Promise.all([
    loadSwapPool(db, {
      targetCardId,
      commanderIds: context.deck.commanders,
      includeGameChangers: context.includeGameChangers,
      excludeIds: [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])],
      ownedIds: only ? [...only] : null,
      poolSize: CANDIDATE_POOL,
    }),
    loadOwnedBoost(db, context),
    loadScoringConfig(),
  ]);
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  return rankSwaps(pool, { context, limit, ownedBoost, scoring });
}

export async function getCutSuggestions(
  db: PublicClient,
  { context, limit = 20 }: { context: RecContext; limit?: number },
): Promise<CutResult> {
  const [served, roleTargets, scoring] = await Promise.all([
    loadServedCuts(db, { commanderIds: context.deck.commanders, mainIds: mainDeckIds(context) }),
    loadRoleTargets(db),
    loadScoringConfig(),
  ]);
  return rankCuts({
    context,
    cards: rankCards(served.rows),
    rates: served.rates,
    roles: served.roles,
    corpus: served.corpus,
    roleTargets,
    scoring,
    limit,
  });
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
  const only = onlyIds(context);
  const [served, roleTargets, roleTags, ownedBoost, scoring] = await Promise.all([
    loadServedAdds(db, {
      commanderIds: context.deck.commanders,
      mainIds: mainDeckIds(context),
      exclude: [...new Set([...deckIds, ...excludeCardIds])],
      allowGameChangers: context.includeGameChangers,
      owned: only ? [...only] : null,
      limit: ADD_POOL,
    }),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadOwnedBoost(db, context),
    loadScoringConfig(),
  ]);
  const { corpus } = served;
  const commanderKey: AddResult["commanderKey"] = {
    id: corpus.keyId as CommanderKeyId | null,
    slug: corpus.slug,
    commanders: context.deck.commanders.flatMap((id) => {
      const row = served.commanderRows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    ...commanderKeyCounts(corpus),
  };
  const mode = modeOf(context);
  if (!corpus.available) return { mode, commanderKey, confidence: "none", groups: [] };

  const groups = rankAdds({
    context,
    poolIds: served.poolIds,
    cards: rankCards(served.pool.rows),
    rates: served.pool.rates,
    roles: new Map([...served.deckRoles, ...served.pool.roles]),
    corpus,
    roleTargets,
    roleTags,
    ownedBoost,
    scoring,
    limitPerCategory,
  });
  return { mode, commanderKey, confidence: corpus.confidence, groups };
}
